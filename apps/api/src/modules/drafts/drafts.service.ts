import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ATTACHMENT_LIMIT,
  type Attachment,
  type CurrencyCode,
  type DealtRate,
  DomainError,
  type Draft,
  type DraftInput,
  type DraftPage,
  type DraftQuery,
  type EntryPreview,
  type PostedDraft,
  type UpdateDraft,
} from '@vertex-mizan/contracts';
import {
  type Database,
  entryAttachments,
  entryDraftLines,
  entryDrafts,
  type PersonActor,
  previewPosting,
  type Transaction,
  withCompany,
  writeCompanyAudit,
} from '@vertex-mizan/db';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { changedFields } from '../../core/audit/audit.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { attachmentTypeOf, FileStore } from '../../core/files/file-store.js';
import { fileNameOf, type UploadedAttachment } from '../../core/files/upload.js';
import { afterCursor, decodeCursor, pageOf } from '../../core/http/cursor.js';
import {
  accountNames,
  attachmentOf,
  conversionOf,
  ledgerCurrencies,
  peopleOf,
  readEntry,
} from '../entries/entry-shape.js';
import {
  auditedLines,
  type DraftRow,
  draftLines,
  draftRow,
  insertDraft,
  readDraft,
  summaryOf,
  writeLines,
} from './draft-shape.js';
import {
  approvalIsOn,
  contentOf,
  missingOf,
  postDraft,
  refusalOf,
  refuseIncomplete,
} from './posting.js';

const PAGE_SIZE = 100;

/** A draft that no longer changes this way: submitted, posted or discarded (S03 rules 8, 11). */
const notEditable = (row: DraftRow) =>
  new CodedException(
    'DRAFT_NOT_EDITABLE',
    `The draft is ${row.archivedAt ? 'discarded' : row.state}`,
  );

/**
 * The drafts of manual entries (S03 rules 4–11, 17): prepared by anyone with `drafts.manage`,
 * posted when approval is off, submitted and approved by someone else when it is on, discarded,
 * with their attachments. Every change is audited in its transaction; a posting goes through
 * `post()` only.
 */
@Injectable()
export class DraftsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /** `GET /api/drafts`: the person's open drafts, every open draft, or the approval queue. */
  async list(access: CompanyRouteAccess, query: DraftQuery): Promise<DraftPage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const lineCount = sql<number>`(select count(*)::int from ${entryDraftLines} l
        where l.company_id = entry_drafts.company_id and l.draft_id = entry_drafts.id
          and l.archived_at is null)`;
      const rows = await tx
        .select({ draft: entryDrafts, lineCount })
        .from(entryDrafts)
        .where(
          and(
            isNull(entryDrafts.archivedAt),
            query.view === 'awaiting'
              ? eq(entryDrafts.state, 'submitted')
              : inArray(entryDrafts.state, ['draft', 'submitted']),
            query.view === 'mine' ? eq(entryDrafts.preparedByUserId, access.person.id) : undefined,
            query.cursor
              ? afterCursor(entryDrafts.updatedAt, entryDrafts.id, decodeCursor(query.cursor))
              : undefined,
          ),
        )
        .orderBy(desc(entryDrafts.updatedAt), desc(entryDrafts.id))
        .limit(PAGE_SIZE + 1);
      const people = await peopleOf(
        tx,
        rows.flatMap(({ draft }) => [draft.preparedByUserId, draft.submittedByUserId]),
      );
      const page = pageOf(
        rows.map((row) => ({ ...row, createdAt: row.draft.updatedAt, id: row.draft.id })),
        PAGE_SIZE,
        (row) => summaryOf(row.draft, row.lineCount, people),
      );
      return { drafts: page.entries, nextCursor: page.nextCursor };
    });
  }

  /** `GET /api/drafts/:id`. */
  async get(access: CompanyRouteAccess, id: string): Promise<Draft> {
    return withCompany(this.db, access.company.id, (tx) => readDraft(tx, id));
  }

  /** `POST /api/drafts` (rule 4): saved as typed, incomplete lines included. */
  async create(access: CompanyRouteAccess, input: DraftInput): Promise<Draft> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const id = await insertDraft(tx, companyId, actorOf(access), input);
      return readDraft(tx, id);
    });
  }

  /**
   * `PUT /api/drafts/:id` (rule 4): any draft being prepared, by anyone with `drafts.manage`, as
   * last read (`DRAFT_CHANGED` otherwise). A reversal's draft keeps its original's lines.
   */
  async update(access: CompanyRouteAccess, id: string, input: UpdateDraft): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      this.editable(row);
      if (row.updatedAt.getTime() !== Date.parse(input.updatedAt)) {
        throw new CodedException('DRAFT_CHANGED', 'The draft changed since it was read');
      }
      if (row.reversesEntryId !== null && (input.lines.length > 0 || input.dealtRates.length > 0)) {
        throw new CodedException('VALIDATION_FAILED', 'A reversal has its original’s lines', [
          { path: ['lines'], message: 'A reversal has its original’s lines' },
        ]);
      }
      const lines = await draftLines(tx, id);
      const changed = changedFields(
        {
          entryDate: row.entryDate,
          description: row.description,
          reference: row.reference,
          // As typed: jsonb gives its keys back in its own order.
          dealtRates: (row.dealtRates as DealtRate[]).map(({ base, quote, rate }) => ({
            base,
            quote,
            rate,
          })),
          lines: auditedLines(lines),
        },
        {
          entryDate: input.entryDate,
          description: input.description,
          reference: input.reference,
          dealtRates: input.dealtRates,
          lines: auditedLines(input.lines),
        },
      );
      await tx
        .update(entryDrafts)
        .set({
          entryDate: input.entryDate,
          description: input.description,
          reference: input.reference,
          dealtRates: input.dealtRates,
          updatedAt: new Date(),
        })
        .where(eq(entryDrafts.id, id));
      if (row.reversesEntryId === null) await writeLines(tx, row.companyId, id, input.lines);
      if (changed) {
        await writeCompanyAudit(tx, row.companyId, actor, {
          action: 'draft.updated',
          entityType: 'entry_draft',
          entityId: id,
          ...changed,
        });
      }
    });
  }

  /**
   * `POST /api/drafts/:id/preview` (rule 7): the lines as they would post now, with the rounding
   * and difference lines, through the posting function's own code and no write; or what refuses
   * them: the missing fields of rule 5, else the posting function's refusal, naming its line.
   */
  async preview(access: CompanyRouteAccess, id: string): Promise<EntryPreview> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const row = await draftRow(tx, id);
      const lines = await draftLines(tx, id);
      const currencies = await ledgerCurrencies(tx);
      const answer = (refusals: EntryPreview['refusals'], built: EntryPreview['lines'] = []) => ({
        entryDate: row.entryDate,
        bookCurrency: currencies.book,
        parallelCurrency: currencies.parallel,
        lines: built,
        refusals,
      });
      const missing = missingOf(row, lines);
      if (missing.length > 0) return answer(missing);
      try {
        const built = await previewPosting(tx, {
          entryDate: row.entryDate,
          content: contentOf(row, lines, todayInDamascus()),
        });
        const accounts = await accountNames(
          tx,
          built.map((line) => line.accountId),
        );
        return answer(
          [],
          built.map((line) => ({
            lineNo: line.lineNo,
            accountId: line.accountId,
            accountCode: accounts.get(line.accountId)?.code ?? '',
            accountName: accounts.get(line.accountId)?.name ?? '',
            dimensionValueIds: [...line.dimensionValueIds],
            kind: line.kind,
            ledger: line.ledger,
            currency: line.currency as CurrencyCode,
            amountMinor: line.amountMinor.toString(),
            bookMinor: line.bookMinor.toString(),
            parallelMinor: line.parallelMinor?.toString() ?? null,
            memo: line.memo,
            conversions: line.conversions.map(conversionOf),
          })),
        );
      } catch (error) {
        if (error instanceof DomainError) return answer([refusalOf(error)]);
        throw error;
      }
    });
  }

  /**
   * `POST /api/drafts/:id/post` (rule 7): approval off only (`APPROVAL_REQUIRED`), a complete draft
   * being prepared, posted now. A second post of a posted draft answers its entry (a double click).
   */
  async post(access: CompanyRouteAccess, id: string): Promise<PostedDraft> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await draftRow(tx, id, 'update');
      if (row.state === 'posted' && row.postedEntryId)
        return this.posted(tx, row.postedEntryId, id);
      this.editable(row);
      if (await approvalIsOn(tx)) {
        throw new CodedException('APPROVAL_REQUIRED', 'Submit the draft for approval');
      }
      const lines = await draftLines(tx, id);
      refuseIncomplete(row, lines);
      const entry = await postDraft(tx, row, lines, actorOf(access), {
        today: todayInDamascus(),
        approvedByUserId: null,
      });
      return this.posted(tx, entry.id, id);
    });
  }

  /** `POST /api/drafts/:id/submit` (rule 8): approval on only, a complete draft being prepared. */
  async submit(access: CompanyRouteAccess, id: string): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      this.editable(row);
      if (!(await approvalIsOn(tx))) {
        throw new CodedException('APPROVAL_NOT_REQUIRED', 'Post the draft instead');
      }
      refuseIncomplete(row, await draftLines(tx, id));
      await tx
        .update(entryDrafts)
        .set({
          state: 'submitted',
          submittedByUserId: actor.userId,
          submittedAt: new Date(),
          rejectedByUserId: null,
          rejectedReason: null,
          rejectedAt: null,
        })
        .where(eq(entryDrafts.id, id));
      await this.audit(tx, row, actor, 'draft.submitted', { state: 'submitted' });
    });
  }

  /** `POST /api/drafts/:id/withdraw` (rule 8): the preparer or submitter takes it back to `draft`. */
  async withdraw(access: CompanyRouteAccess, id: string): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      if (row.state !== 'submitted') throw notEditable(row);
      if (actor.userId !== row.preparedByUserId && actor.userId !== row.submittedByUserId) {
        throw new CodedException('FORBIDDEN', 'Only its preparer or submitter withdraws a draft');
      }
      await tx
        .update(entryDrafts)
        .set({ state: 'draft', submittedByUserId: null, submittedAt: null })
        .where(eq(entryDrafts.id, id));
      await this.audit(tx, row, actor, 'draft.withdrawn', { state: 'draft' });
    });
  }

  /**
   * `POST /api/drafts/:id/discard` (rule 11): a draft being prepared, with an optional reason; its
   * files are archived with it and stay on disk (edge case 22).
   */
  async discard(access: CompanyRouteAccess, id: string, reason: string | null): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      this.editable(row);
      const now = new Date();
      await tx
        .update(entryAttachments)
        .set({ archivedAt: now })
        .where(and(eq(entryAttachments.draftId, id), isNull(entryAttachments.archivedAt)));
      await tx
        .update(entryDrafts)
        .set({ archivedAt: now, archivedReason: reason })
        .where(eq(entryDrafts.id, id));
      await writeCompanyAudit(tx, row.companyId, actor, {
        action: 'draft.discarded',
        entityType: 'entry_draft',
        entityId: id,
        reason,
        before: { archivedReason: null },
        after: { archivedReason: reason },
      });
    });
  }

  /**
   * `POST /api/drafts/:id/approve` (rule 8): a submitted draft, by someone who neither prepared nor
   * submitted it (`APPROVER_IS_PREPARER`), posted now with them as its approver. A second approval
   * of the same draft finds it posted (`DRAFT_NOT_EDITABLE`, edge case 2).
   */
  async approve(access: CompanyRouteAccess, id: string): Promise<PostedDraft> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await draftRow(tx, id, 'update');
      const actor = actorOf(access);
      this.approvable(row, actor);
      const lines = await draftLines(tx, id);
      refuseIncomplete(row, lines);
      const entry = await postDraft(tx, row, lines, actor, {
        today: todayInDamascus(),
        approvedByUserId: actor.userId,
      });
      await this.audit(tx, row, actor, 'draft.approved', {
        state: 'posted',
        postedEntryId: entry.id,
      });
      return this.posted(tx, entry.id, id);
    });
  }

  /** `POST /api/drafts/:id/reject` (rule 8): back to `draft` with the reason the preparer reads. */
  async reject(access: CompanyRouteAccess, id: string, reason: string): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      this.approvable(row, actor);
      await tx
        .update(entryDrafts)
        .set({
          state: 'draft',
          submittedByUserId: null,
          submittedAt: null,
          rejectedByUserId: actor.userId,
          rejectedReason: reason,
          rejectedAt: new Date(),
        })
        .where(eq(entryDrafts.id, id));
      await writeCompanyAudit(tx, row.companyId, actor, {
        action: 'draft.rejected',
        entityType: 'entry_draft',
        entityId: id,
        reason,
        before: { state: 'submitted' },
        after: { state: 'draft', rejectedReason: reason },
      });
    });
  }

  /**
   * `POST /api/drafts/:id/attachments` (rule 17): a PDF, PNG, JPEG or WebP by its first bytes
   * (`ATTACHMENT_TYPE`), 20 at most (`ATTACHMENT_LIMIT`), on a draft being prepared.
   */
  async attach(
    access: CompanyRouteAccess,
    id: string,
    upload: UploadedAttachment | undefined,
  ): Promise<Attachment> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await draftRow(tx, id, 'update');
      this.editable(row);
      return storeAttachment(tx, this.files, companyId, actorOf(access), { draftId: id }, upload);
    });
  }

  /** `DELETE /api/drafts/:id/attachments/:attachmentId`: archived from a draft being prepared. */
  async removeAttachment(
    access: CompanyRouteAccess,
    id: string,
    attachmentId: string,
  ): Promise<Draft> {
    return this.change(access, id, async (tx, row, actor) => {
      this.editable(row);
      const [attachment] = await tx
        .select()
        .from(entryAttachments)
        .where(
          and(
            eq(entryAttachments.id, attachmentId),
            eq(entryAttachments.draftId, id),
            isNull(entryAttachments.archivedAt),
          ),
        );
      if (!attachment) throw new CodedException('NOT_FOUND', 'No such attachment on the draft');
      await tx
        .update(entryAttachments)
        .set({ archivedAt: new Date() })
        .where(eq(entryAttachments.id, attachmentId));
      await writeCompanyAudit(tx, row.companyId, actor, {
        action: 'attachment.removed',
        entityType: 'attachment',
        entityId: attachmentId,
        before: { fileName: attachment.fileName, draftId: id },
        after: null,
      });
    });
  }

  /** A change of a draft under its row lock, answered with the draft as it now is. */
  private change(
    access: CompanyRouteAccess,
    id: string,
    work: (tx: Transaction, row: DraftRow, actor: PersonActor) => Promise<void>,
  ): Promise<Draft> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const row = await draftRow(tx, id, 'update');
      await work(tx, row, actorOf(access));
      return readDraft(tx, id);
    });
  }

  /** A draft being prepared: in `draft`, not discarded. */
  private editable(row: DraftRow): void {
    if (row.state !== 'draft' || row.archivedAt !== null) throw notEditable(row);
  }

  /** A submitted draft, and an approver who neither prepared nor submitted it (rule 8). */
  private approvable(row: DraftRow, actor: PersonActor): void {
    if (row.state !== 'submitted') throw notEditable(row);
    if (actor.userId === row.preparedByUserId || actor.userId === row.submittedByUserId) {
      throw new CodedException(
        'APPROVER_IS_PREPARER',
        'A draft is approved by someone who neither prepared nor submitted it',
      );
    }
  }

  private async audit(
    tx: Transaction,
    row: DraftRow,
    actor: PersonActor,
    action: 'draft.submitted' | 'draft.withdrawn' | 'draft.approved',
    after: Record<string, unknown>,
  ): Promise<void> {
    await writeCompanyAudit(tx, row.companyId, actor, {
      action,
      entityType: 'entry_draft',
      entityId: row.id,
      before: { state: row.state },
      after,
    });
  }

  private async posted(tx: Transaction, entryId: string, draftId: string): Promise<PostedDraft> {
    return { entry: await readEntry(tx, entryId), draft: await readDraft(tx, draftId) };
  }
}

/**
 * Stores an attachment of a draft or a posted entry (rule 17): its type from its first bytes
 * (`ATTACHMENT_TYPE`), 20 unarchived at most (`ATTACHMENT_LIMIT`), its file under its storage key
 * before the row commits, its SHA-256, and its `attachment.added` audit row. The caller has locked
 * the draft or the entry's attachments.
 */
export async function storeAttachment(
  tx: Transaction,
  files: FileStore,
  companyId: string,
  actor: PersonActor,
  owner: { draftId: string } | { entryId: string },
  upload: UploadedAttachment | undefined,
): Promise<Attachment> {
  if (!upload) {
    throw new CodedException('VALIDATION_FAILED', 'A file is required', [
      { path: ['file'], message: 'A file is required' },
    ]);
  }
  const contentType = attachmentTypeOf(upload.buffer);
  if (contentType === null) {
    throw new CodedException('ATTACHMENT_TYPE', 'A PDF, PNG, JPEG or WebP file only');
  }
  const [held] = await tx
    .select({ n: count() })
    .from(entryAttachments)
    .where(
      and(
        'draftId' in owner
          ? eq(entryAttachments.draftId, owner.draftId)
          : eq(entryAttachments.entryId, owner.entryId),
        isNull(entryAttachments.archivedAt),
      ),
    );
  if ((held?.n ?? 0) >= ATTACHMENT_LIMIT) {
    throw new CodedException('ATTACHMENT_LIMIT', `${ATTACHMENT_LIMIT} files at most`);
  }
  const id = uuidv7();
  const sha256 = createHash('sha256').update(upload.buffer).digest('hex');
  const fileName = fileNameOf(upload);
  const [row] = await tx
    .insert(entryAttachments)
    .values({
      id,
      companyId,
      ...owner,
      fileName,
      contentType,
      sizeBytes: upload.buffer.length,
      sha256,
      storageKey: `${companyId}/${id}`,
      uploadedByUserId: actor.userId,
    })
    .returning();
  if (!row) throw new Error('No attachment stored');
  await files.write(companyId, id, upload.buffer);
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'attachment.added',
    entityType: 'attachment',
    entityId: id,
    after: { fileName, contentType, sizeBytes: row.sizeBytes, sha256, ...owner },
  });
  return attachmentOf(row, await peopleOf(tx, [actor.userId]));
}
