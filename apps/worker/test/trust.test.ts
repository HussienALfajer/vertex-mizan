import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { type CompanyLedgers, emailDataSchemas } from '@vertex-mizan/contracts';
import {
  chainAnchors,
  chartAccounts,
  companyExports,
  createCompanyBooks,
  createDatabase,
  type Database,
  emailOutbox,
  entryAttachments,
  journalEntries,
  memberships,
  type PersonActor,
  post,
  recordRate,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { dayBefore, todayInDamascus } from '../src/core/clock/today.js';
import { type Config, loadConfig } from '../src/core/config/config.js';
import { FileStore } from '../src/core/files/file-store.js';
import { csvField } from '../src/jobs/company/archive.js';
import { CompanyExportJob, EXPORT_ATTEMPTS } from '../src/jobs/company/export.job.js';
import { CompanyExportExpireJob } from '../src/jobs/company/export-expire.job.js';
import { renderEmail } from '../src/jobs/email/templates.js';
import { DailyAnchorJob } from '../src/jobs/ledger/daily-anchor.job.js';

// S03's trust jobs on the run's database: the daily anchor as the jobs role, and the full export
// and its expiry, found as the jobs role and worked as the app role. All people, companies and
// amounts are synthetic.

let db: Database;
let jobs: Database;
let config: Config;
let files: FileStore;

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const people = { first: '', second: '' };

const actor = (userId = people.first): PersonActor => ({
  kind: 'person',
  userId,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-worker-trust-test',
  ipAddress: null,
  userAgent: null,
});

/** A company owned by `owners`, with `entries` posted today. */
async function company(name: string, owners: string[], entries: number): Promise<string> {
  const id = uuidv7();
  await withCompany(db, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name,
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: people.first,
      },
      actor(),
    );
    for (const [type, rate] of [
      ['bulletin', '121.5000'],
      ['market', '122.0000'],
    ] as const) {
      await recordRate(tx, id, actor(), {
        effectiveOn: '2026-11-08',
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
  await db
    .insert(memberships)
    .values(owners.map((userId) => ({ userId, scopeCompanyId: id, role: 'owner' as const })));
  for (let n = 0; n < entries; n += 1) {
    await withCompany(db, id, async (tx) => {
      const accounts = new Map(
        (
          await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)
        ).map((row) => [row.code, row.id]),
      );
      const line = (code: string, amountMinor: bigint) => ({
        accountId: accounts.get(code) as string,
        dimensionValueIds: [],
        currency: 'SYP' as const,
        amountMinor,
        memo: null,
      });
      await post(tx, {
        client: 'manual',
        idempotencyKey: uuidv7(),
        entryDate: '2026-11-08',
        description: '-قيد تجريبي, "مقتبس"',
        reference: null,
        draftId: null,
        preparedByUserId: people.first,
        approvedByUserId: null,
        actor: actor(),
        content: {
          kind: 'manual',
          today: '2026-11-30',
          dealtRates: [],
          lines: [line('111003', 1_234_567n), line('111001', -1_234_567n)],
        },
      });
    });
  }
  return id;
}

const heads = (companyId: string) =>
  withCompany(db, companyId, (tx) =>
    tx
      .select({ id: journalEntries.id, hash: journalEntries.hash })
      .from(journalEntries)
      .orderBy(asc(journalEntries.sequence)),
  );

let both = '';
let single = '';

beforeAll(async () => {
  db = createDatabase(inject('appUrl'));
  jobs = createDatabase(inject('jobsUrl'));
  const directory = await mkdtemp(join(tmpdir(), 'mizan-worker-files-'));
  config = loadConfig({
    DATABASE_QUEUE_URL: inject('queueUrl'),
    DATABASE_APP_URL: inject('appUrl'),
    DATABASE_JOBS_URL: inject('jobsUrl'),
    APP_URL: 'https://mizan.example.test',
    MIZAN_FILES_DIR: directory,
    SMTP_URL: 'smtp://127.0.0.1:1',
    EMAIL_FROM: 'Mizan <mizan@example.test>',
    NODE_ENV: 'test',
  });
  files = new FileStore(config);
  for (const key of Object.keys(people) as (keyof typeof people)[]) {
    const [row] = await db
      .insert(users)
      .values({ email: `worker.trust.${key}@example.test`, name: 'مالك تجريبي' })
      .returning({ id: users.id });
    people[key] = row?.id as string;
  }
  both = await company('شركة أولى', [people.first, people.second], 2);
  single = await company('شركة ثانية', [people.first], 1);
});
afterAll(async () => {
  await db.$client.end();
  await jobs.$client.end();
});

describe('ledger.daily-anchor', () => {
  it('anchors each company’s head and emails each owner the anchors of all their companies', async () => {
    const job = new DailyAnchorJob(jobs);
    const empty = await company('شركة بلا قيود', [people.second], 0);
    // Yesterday ended before any of these entries was posted: nothing to anchor for it.
    const yesterday = await job.anchor(dayBefore(todayInDamascus()));
    expect(yesterday.anchors).toBe(0);

    const today = todayInDamascus();
    const run = await job.anchor(today);
    expect(run).toEqual({ anchoredOn: today, anchors: 2, emails: 2 });
    const anchors = await Promise.all(
      [both, single, empty].map((id) =>
        withCompany(db, id, (tx) => tx.select().from(chainAnchors)),
      ),
    );
    const [bothHeads, singleHeads] = [await heads(both), await heads(single)];
    expect(anchors[0]).toEqual([
      expect.objectContaining({ anchoredOn: today, entryCount: 2n, headHash: bothHeads[1]?.hash }),
    ]);
    expect(anchors[1]).toEqual([
      expect.objectContaining({ entryCount: 1n, headEntryId: singleHeads[0]?.id }),
    ]);
    expect(anchors[2]).toEqual([]);

    const emails = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.kind, 'daily_anchor'))
      .orderBy(asc(emailOutbox.recipient));
    expect(emails.map((email) => email.recipient)).toEqual([
      'worker.trust.first@example.test',
      'worker.trust.second@example.test',
    ]);
    const [first, second] = emails.map((email) => emailDataSchemas.daily_anchor.parse(email.data));
    expect(first?.anchors.map((anchor) => anchor.companyName)).toEqual(['شركة أولى', 'شركة ثانية']);
    expect(second?.anchors).toEqual([
      { companyName: 'شركة أولى', entryCount: 2, headHash: bothHeads[1]?.hash },
    ]);
    // Each anchor names the emails that carried it.
    expect([...(anchors[0]?.[0]?.emailOutboxIds ?? [])].sort()).toEqual(
      emails.map((email) => email.id).sort(),
    );
    const rendered = renderEmail(
      'daily_anchor',
      emails[1]?.data,
      'worker.trust.second@example.test',
    );
    expect(rendered.subject).toContain(today);
    expect(rendered.text).toContain(bothHeads[1]?.hash as string);
    expect(rendered.text).not.toMatch(/[٠-٩]/);

    // A second run, or a retry, writes nothing and sends nothing.
    expect(await job.anchor(today)).toEqual({ anchoredOn: today, anchors: 0, emails: 0 });
    await db.delete(emailOutbox).where(eq(emailOutbox.kind, 'daily_anchor'));
  });
});

/** The entries of a ZIP file, by name. */
async function unzip(path: string): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  );
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  return entries;
}

const requestExport = (companyId: string) =>
  withCompany(db, companyId, (tx) =>
    tx
      .insert(companyExports)
      .values({ companyId, requestedByUserId: people.first })
      .returning()
      .then(([row]) => row as typeof companyExports.$inferSelect),
  );

const exportRow = (companyId: string, id: string) =>
  withCompany(db, companyId, (tx) =>
    tx
      .select()
      .from(companyExports)
      .where(eq(companyExports.id, id))
      .then(([row]) => row as typeof companyExports.$inferSelect),
  );

describe('company.export', () => {
  it('writes every company table, the attachments and a manifest, then emails the owner', async () => {
    const [entry] = await heads(both);
    const attachmentId = uuidv7();
    const pdf = Buffer.from('%PDF-1.7\n% ملف تجريبي\n%%EOF\n');
    await withCompany(db, both, (tx) =>
      tx.insert(entryAttachments).values({
        id: attachmentId,
        companyId: both,
        entryId: entry?.id,
        fileName: 'إيصال.pdf',
        contentType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        storageKey: `${both}/${attachmentId}`,
        uploadedByUserId: people.first,
      }),
    );
    await files.write(both, attachmentId, Readable.from([pdf]));
    const requested = await requestExport(both);
    const job = new CompanyExportJob(jobs, db, files, config);
    expect(await job.run()).toEqual({ built: 1, failed: 0 });

    const row = await exportRow(both, requested.id);
    expect(row).toMatchObject({ state: 'ready', storageKey: `${both}/${requested.id}` });
    const path = join(config.filesDir, both, requested.id);
    const zipped = await readFile(path);
    expect(row.sizeBytes).toBe(zipped.length);
    expect(row.sha256).toBe(createHash('sha256').update(zipped).digest('hex'));
    expect((row.expiresAt?.getTime() ?? 0) - row.updatedAt.getTime()).toBeCloseTo(
      24 * 3_600_000,
      -5,
    );

    const archive = await unzip(path);
    const manifest = JSON.parse(archive.get('manifest.json')?.toString() ?? '{}');
    expect(manifest).toMatchObject({
      format: { name: 'mizan-company-export', version: 1 },
      exportId: requested.id,
      companyId: both,
      companyName: 'شركة أولى',
      chainHead: { entryCount: '2' },
      ledgers: { bookCurrency: 'SYP', parallelCurrency: 'USD' },
      missingAttachments: [],
    });
    for (const file of manifest.files as { path: string; sha256: string; bytes: number }[]) {
      const data = archive.get(file.path) as Buffer;
      expect(data.length, file.path).toBe(file.bytes);
      expect(createHash('sha256').update(data).digest('hex'), file.path).toBe(file.sha256);
    }
    const tables = new Map(
      (manifest.tables as { name: string; rows: number }[]).map((table) => [
        table.name,
        table.rows,
      ]),
    );
    expect(tables.get('journal_entries')).toBe(2);
    expect(tables.get('journal_lines')).toBe(4);
    expect(tables.get('company_exports')).toBe(1);
    expect(archive.get(`attachments/${attachmentId}`)).toEqual(pdf);
    // The README says which currency each amount column is in, and that SYP is the new pound.
    const readme = archive.get('README.md')?.toString('utf8') ?? '';
    expect(readme).toContain('الليرة السورية الجديدة');
    expect(readme).toContain('SYP is the new Syrian pound');
    expect(readme).toContain('`book_*`');
    expect(readme).toContain('`parallel_*`');
    // Amounts as integer strings, rates exactly as stored, dates as dates.
    const lines = JSON.parse(archive.get('tables/journal_lines.json')?.toString() ?? '[]');
    expect(lines.map((line: { amount_minor: string }) => line.amount_minor).sort()).toEqual([
      '-1234567',
      '-1234567',
      '1234567',
      '1234567',
    ]);
    const entries = JSON.parse(archive.get('tables/journal_entries.json')?.toString() ?? '[]');
    expect(entries[0]).toMatchObject({ entry_date: '2026-11-08', sequence: '1', company_id: both });
    expect(entries[0].posted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const rates = JSON.parse(archive.get('tables/exchange_rates.json')?.toString() ?? '[]');
    expect(rates.map((rate: { rate: string }) => rate.rate).sort()).toEqual([
      '121.5000000000',
      '122.0000000000',
    ]);
    const csv = archive.get('tables/journal_entries.csv')?.toString('utf8') ?? '';
    expect(csv.startsWith('﻿id,company_id,')).toBe(true);
    expect(csv).toContain(`"'-قيد تجريبي, ""مقتبس"""`);
    // Only this company's rows.
    const other = JSON.parse(archive.get('tables/chart_accounts.json')?.toString() ?? '[]');
    expect(new Set(other.map((account: { company_id: string }) => account.company_id))).toEqual(
      new Set([both]),
    );

    const [email] = await db.select().from(emailOutbox).where(eq(emailOutbox.kind, 'export_ready'));
    expect(email).toMatchObject({
      recipient: 'worker.trust.first@example.test',
      data: {
        companyName: 'شركة أولى',
        link: 'https://mizan.example.test/settings/export',
        expiresAt: row.expiresAt?.toISOString(),
      },
    });
    expect(renderEmail('export_ready', email?.data, email?.recipient ?? '').text).toContain(
      'https://mizan.example.test/settings/export',
    );
    // A second run finds nothing queued.
    expect(await job.run()).toEqual({ built: 0, failed: 0 });
    await db.delete(emailOutbox).where(eq(emailOutbox.kind, 'export_ready'));
  });

  it('marks an export failed with its code when the file cannot be written', async () => {
    const blocked = join(config.filesDir, 'not-a-directory');
    await writeFile(blocked, 'a file where the directory should be');
    const broken = loadConfig({
      DATABASE_QUEUE_URL: inject('queueUrl'),
      DATABASE_APP_URL: inject('appUrl'),
      DATABASE_JOBS_URL: inject('jobsUrl'),
      MIZAN_FILES_DIR: blocked,
      SMTP_URL: 'smtp://127.0.0.1:1',
      EMAIL_FROM: 'Mizan <mizan@example.test>',
      NODE_ENV: 'test',
    });
    const requested = await requestExport(single);
    const job = new CompanyExportJob(jobs, db, new FileStore(broken), broken);
    expect(await job.run()).toEqual({ built: 0, failed: 1 });
    expect(await exportRow(single, requested.id)).toMatchObject({
      state: 'failed',
      error: 'ENOTDIR',
      storageKey: null,
    });
    expect(
      await db
        .select()
        .from(emailOutbox)
        .where(inArray(emailOutbox.kind, ['export_ready'])),
    ).toEqual([]);
  });
});

describe('company.export, when a build cannot finish', () => {
  /** An attachment on the first entry of `companyId`, recorded with `recorded` but holding `file`. */
  async function attach(companyId: string, recorded: Buffer, file: Buffer | null) {
    const [entry] = await heads(companyId);
    const id = uuidv7();
    await withCompany(db, companyId, (tx) =>
      tx.insert(entryAttachments).values({
        id,
        companyId,
        entryId: entry?.id,
        fileName: 'إيصال.pdf',
        contentType: 'application/pdf',
        sizeBytes: recorded.length,
        sha256: createHash('sha256').update(recorded).digest('hex'),
        storageKey: `${companyId}/${id}`,
        uploadedByUserId: people.first,
      }),
    );
    if (file) await files.write(companyId, id, Readable.from([file]));
    return id;
  }

  it('fails on an attachment changed after its upload, leaving no file behind', async () => {
    const companyId = await company('شركة مرفق معدّل', [people.first], 1);
    await attach(companyId, Buffer.from('%PDF-1.7 كما رُفع'), Buffer.from('%PDF-1.7 معدّل'));
    const requested = await requestExport(companyId);
    expect(await new CompanyExportJob(jobs, db, files, config).run()).toEqual({
      built: 0,
      failed: 1,
    });
    expect(await exportRow(companyId, requested.id)).toMatchObject({
      state: 'failed',
      error: 'ATTACHMENT_CHANGED',
      attempts: 1,
    });
    const left = await readdir(join(config.filesDir, companyId));
    expect(left.filter((name) => name.startsWith(requested.id))).toEqual([]);
  });

  it('lists an attachment whose file is gone, and exports the rest', async () => {
    const companyId = await company('شركة مرفق مفقود', [people.first], 1);
    const missing = await attach(companyId, Buffer.from('%PDF-1.7 مفقود'), null);
    const requested = await requestExport(companyId);
    expect(await new CompanyExportJob(jobs, db, files, config).run()).toMatchObject({ built: 1 });
    const archive = await unzip(join(config.filesDir, companyId, requested.id));
    expect(JSON.parse(archive.get('manifest.json')?.toString() ?? '{}')).toMatchObject({
      missingAttachments: [missing],
    });
    expect(archive.has(`attachments/${missing}`)).toBe(false);
    await db.delete(emailOutbox).where(eq(emailOutbox.kind, 'export_ready'));
  });

  it('fails an export whose builds keep dying, after three attempts', async () => {
    const companyId = await company('شركة محاولات', [people.first], 1);
    const requested = await requestExport(companyId);
    // Three builds started and never finished (the worker was killed each time), leaving their
    // temporary files.
    const partial = join(config.filesDir, companyId, `${requested.id}.${uuidv7()}.partial`);
    await files.write(companyId, uuidv7(), Readable.from(['يفتح المجلد']));
    await writeFile(partial, 'PK an archive cut short');
    await withCompany(db, companyId, (tx) =>
      tx
        .update(companyExports)
        .set({ attempts: EXPORT_ATTEMPTS })
        .where(eq(companyExports.id, requested.id)),
    );
    expect(await new CompanyExportJob(jobs, db, files, config).run()).toEqual({
      built: 0,
      failed: 1,
    });
    expect(await exportRow(companyId, requested.id)).toMatchObject({
      state: 'failed',
      error: 'EXPORT_ATTEMPTS',
    });
    await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('opens one attachment at a time, each when the archive reaches it', async () => {
    const companyId = await company('شركة مرفقات كثيرة', [people.first], 1);
    const contents = [1, 2, 3].map((n) => Buffer.from(`%PDF-1.7 مرفق ${n}`));
    for (const content of contents) await attach(companyId, content, content);
    const events: string[] = [];
    const open = files.open.bind(files);
    const spy = vi.spyOn(files, 'open').mockImplementation((company, id) => {
      events.push(`open ${id}`);
      const stream = open(company, id);
      stream.on('close', () => events.push(`close ${id}`));
      return stream;
    });
    try {
      await requestExport(companyId);
      expect(await new CompanyExportJob(jobs, db, files, config).run()).toMatchObject({
        built: 1,
      });
    } finally {
      spy.mockRestore();
    }
    expect(events).toHaveLength(6);
    for (let index = 0; index < events.length; index += 2) {
      const id = events[index]?.slice('open '.length);
      expect(events.slice(index, index + 2)).toEqual([`open ${id}`, `close ${id}`]);
    }
    await db.delete(emailOutbox).where(eq(emailOutbox.kind, 'export_ready'));
  });
});

describe('company.export-expire', () => {
  it('deletes the file of an export past its 24 hours and marks it expired, once', async () => {
    // Ready since yesterday, as the export job leaves it: its file and its time.
    const requested = await requestExport(single);
    const zip = Buffer.from('PK synthetic archive');
    await files.write(single, requested.id, Readable.from([zip]));
    const ready = (expiresAt: Date) =>
      withCompany(db, single, (tx) =>
        tx
          .update(companyExports)
          .set({
            state: 'ready',
            storageKey: `${single}/${requested.id}`,
            sizeBytes: zip.length,
            sha256: createHash('sha256').update(zip).digest('hex'),
            expiresAt,
          })
          .where(eq(companyExports.id, requested.id)),
      );
    await ready(new Date(Date.now() - 1000));
    const path = join(config.filesDir, single, requested.id);
    const expire = new CompanyExportExpireJob(jobs, db, files);
    expect(await expire.run()).toEqual({ expired: 1 });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    const row = await exportRow(single, requested.id);
    expect(row).toMatchObject({ state: 'expired', storageKey: `${single}/${requested.id}` });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await expire.run()).toEqual({ expired: 0 });
  });

  it('leaves an export within its 24 hours', async () => {
    const other = await company('شركة ثالثة', [people.first], 1);
    const requested = await requestExport(other);
    expect(await new CompanyExportJob(jobs, db, files, config).run()).toMatchObject({ built: 1 });
    expect(await new CompanyExportExpireJob(jobs, db, files).run()).toEqual({ expired: 0 });
    expect(await exportRow(other, requested.id)).toMatchObject({ state: 'ready' });
    await db.delete(emailOutbox).where(eq(emailOutbox.kind, 'export_ready'));
  });
});

describe('csvField', () => {
  it('quotes what CSV needs and disarms what a spreadsheet would run', () => {
    expect(csvField(null)).toBe('');
    expect(csvField('-1225000')).toBe('-1225000');
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('-قيد')).toBe("'-قيد");
    expect(csvField('أ, "ب"')).toBe('"أ, ""ب"""');
    expect(csvField(['a', 'b'])).toBe('"[""a"",""b""]"');
    expect(csvField(true)).toBe('true');
  });
});
