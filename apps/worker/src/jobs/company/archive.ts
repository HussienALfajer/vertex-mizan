import { createHash } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import {
  companies,
  companySettings,
  entryAttachments,
  ledgerHeads,
  type Transaction,
  tableRegistry,
} from '@vertex-mizan/db';
import { asc, eq, sql } from 'drizzle-orm';
import { ZipFile } from 'yazl';

// The full export's archive (S03 rule 21): every company table as JSON and CSV, the attachments'
// files, a manifest with the row counts, every file's SHA-256, the ledgers' currencies and the
// chain head, and a README in Arabic and English. Read inside the caller's company context and
// snapshot, and streamed to its file as it is built: a table at a time, an attachment as it is
// read, never the whole archive in memory.

/** The export's format, named in its manifest; a change of layout is a new version. */
export const EXPORT_FORMAT = { name: 'mizan-company-export', version: 1 } as const;

/** The company tables of the registry, in its order: every one is exported, later specs' too. */
export const EXPORTED_TABLES = Object.entries(tableRegistry)
  .filter(([, info]) => info.scope === 'company')
  .map(([name]) => name);

type Value = string | number | boolean | null | object;
type Row = Record<string, Value>;

/**
 * Each column as the archive writes it: JSON and arrays as JSON, booleans and small integers as
 * they are, times in UTC with microseconds, and everything else as PostgreSQL prints it, so an
 * amount (`bigint`) or a rate (`numeric`) is an exact integer or decimal string, never a float.
 */
function columnValue(name: string, type: string) {
  const column = sql.identifier(name);
  if (type === 'jsonb' || type === 'json' || type === 'ARRAY') return sql`to_jsonb(${column})`;
  if (type === 'boolean' || type === 'integer' || type === 'smallint') return sql`${column}`;
  if (type === 'timestamp with time zone') {
    return sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  }
  // Whatever the server's DateStyle.
  if (type === 'date') return sql`to_char(${column}, 'YYYY-MM-DD')`;
  return sql`${column}::text`;
}

async function readTable(
  tx: Transaction,
  table: string,
): Promise<{ columns: string[]; rows: Row[] }> {
  const columns = (
    await tx.execute<{ name: string; type: string }>(sql`
      select column_name as name, data_type as type from information_schema.columns
      where table_schema = 'public' and table_name = ${table}
      order by ordinal_position`)
  ).rows;
  const selected = sql.join(
    columns.map(
      (column) => sql`${columnValue(column.name, column.type)} as ${sql.identifier(column.name)}`,
    ),
    sql`, `,
  );
  const rows = (
    await tx.execute<Row>(sql`select ${selected} from ${sql.identifier(table)} order by id`)
  ).rows;
  return { columns: columns.map((column) => column.name), rows };
}

/**
 * A CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. Text a
 * spreadsheet would run as a formula (starting with `=`, `+`, `@`, a tab, or a `-` that is not a
 * number) is prefixed with `'`.
 */
export function csvField(value: Value): string {
  if (value === null) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvOf(columns: readonly string[], rows: readonly Row[]): Buffer {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => csvField(row[c] ?? null)).join(',')),
  ];
  // A byte-order mark, so a spreadsheet reads the Arabic text as UTF-8.
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** The README of every archive: what it holds and how to read its amounts (S03 rule 21). */
export const README = `# تصدير بيانات الشركة من ميزان · Mizan company export

## بالعربية
هذا الملف تصدير كامل لبيانات شركة واحدة من ميزان، أُخذ من لقطة واحدة متسقة لقاعدة البيانات.
- \`company.json\`: بيانات الشركة.
- \`tables/<الجدول>.json\` و\`tables/<الجدول>.csv\`: كل جدول من جداول الشركة بصيغتين (الإعدادات، دليل الحسابات، الأبعاد، الأسعار، القيود وأسطرها وتحويلاتها، مجموعات الأبعاد، المسودات، بيانات المرفقات، الفترات وأرصدتها، مراسي السلسلة، سجل التدقيق).
- \`attachments/<المعرّف>\`: ملفات المرفقات، وأسماؤها الأصلية وأنواعها في \`tables/entry_attachments\`.
- \`manifest.json\`: الجداول وعدد صفوفها، وبصمة SHA-256 لكل ملف، وعملتا الدفترين، ورأس سلسلة القيود.

المبالغ أعداد صحيحة بأصغر وحدة للعملة (القرش أو السنت) مكتوبة نصًا. مبلغ المعاملة (\`amount_minor\` وما يشبهه) بالعملة المذكورة في عمود \`currency\` بجانبه؛ أما أعمدة \`book_*\` فبعملة الدفتر الأساسي، وأعمدة \`parallel_*\` بعملة الدفتر الموازي، كما في \`tables/company_settings\` (\`book_currency\` و\`parallel_currency\`) وفي \`manifest.json\`. الرمز SYP يعني الليرة السورية الجديدة، بعد حذف صفرين من الليرة القديمة. الأسعار كما سُجّلت، والأوقات بتوقيت UTC، والتواريخ بصيغة YYYY-MM-DD. في ملفات CSV يسبق نصًّا يبدأ بعلامة قد يعدّها برنامج الجداول صيغة (= أو + أو @ أو - ليست عددًا) علامةُ '.

## English
A full export of one company's data from Mizan, read from one consistent snapshot of the database.
- \`company.json\`: the company.
- \`tables/<table>.json\` and \`tables/<table>.csv\`: every company table in both forms (settings, chart of accounts, dimensions, rates, entries with their lines and conversions, dimension sets, drafts, attachments' metadata, periods and period balances, chain anchors, the audit log).
- \`attachments/<id>\`: the attachments' files; their names and types are in \`tables/entry_attachments\`.
- \`manifest.json\`: the tables and their row counts, every file's SHA-256, the two ledgers' currencies and the chain head.

Amounts are integers in minor units of their currency, written as strings. A transaction amount (\`amount_minor\` and the like) is in the currency of the \`currency\` column beside it; the \`book_*\` columns are in the book ledger's currency and the \`parallel_*\` columns in the parallel ledger's, as \`tables/company_settings\` (\`book_currency\`, \`parallel_currency\`) and \`manifest.json\` state. SYP is the new Syrian pound (الليرة السورية الجديدة), the old pound with two zeros removed. Rates are as recorded, times in UTC, dates as YYYY-MM-DD. In the CSV files, text a spreadsheet would read as a formula (starting with =, +, @ or a - that is not a number) is prefixed with '.
`;

/** One file the archive holds, as the manifest lists it. */
export interface ArchiveFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The attachments' files, as the worker's `FileStore` keeps them. */
export interface AttachmentFiles {
  /** The file's size, or null when it is not on disk. */
  size(id: string): Promise<number | null>;
  open(id: string): Readable;
}

/** An attachment whose file no longer has the digest recorded when it was uploaded. */
export class AttachmentChangedError extends Error {
  readonly code = 'ATTACHMENT_CHANGED';
}

/**
 * Passes an attachment through, failing the archive if its bytes are not the ones recorded at
 * upload (`entry_attachments.sha256` and `size_bytes`), so the manifest's digest is the file's.
 */
function verified(source: Readable, expected: { sha256: string; bytes: number }): Readable {
  const hash = createHash('sha256');
  let bytes = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, next) {
      hash.update(chunk);
      bytes += chunk.length;
      next(null, chunk);
    },
    flush(next) {
      const same = bytes === expected.bytes && hash.digest('hex') === expected.sha256;
      next(same ? null : new AttachmentChangedError('An attachment changed after its upload'));
    },
  });
  source.on('error', (error) => check.destroy(error));
  return source.pipe(check);
}

/**
 * Writes the archive of `companyId`'s data: `sink` receives the ZIP as a stream and must consume
 * it (the file store writes it through a temporary name), while the archive is built from `tx`
 * (the company's context, a repeatable-read snapshot). An attachment whose file is gone is listed
 * in the manifest; one whose file changed fails the archive. Resolves with the ZIP's size and
 * SHA-256 once `sink` has written all of it.
 */
export async function writeArchive(
  tx: Transaction,
  companyId: string,
  exportId: string,
  attachmentFiles: AttachmentFiles,
  sink: (archive: Readable) => Promise<void>,
): Promise<{ size: number; sha256: string }> {
  // Counts and hashes the ZIP as it passes, without reading it ahead of its consumer.
  const hash = createHash('sha256');
  let size = 0;
  let digest: { size: number; sha256: string } | null = null;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, next) {
      hash.update(chunk);
      size += chunk.length;
      next(null, chunk);
    },
    flush(next) {
      digest = { size, sha256: hash.digest('hex') };
      next();
    },
  });
  const zip = new ZipFile();
  const fail = (error: Error) => counted.destroy(error);
  zip.on('error', fail);
  zip.outputStream.on('error', fail);
  zip.outputStream.pipe(counted);
  const writing = sink(counted);
  // A sink that fails early (its folder cannot be made) stops the archive; the failure is
  // answered below, when the archive awaits it.
  writing.catch(() => counted.destroy());
  // Every failure of the stream reaches the caller through `writing`, which consumes it.
  counted.on('error', () => undefined);

  try {
    const files: ArchiveFile[] = [];
    const add = (path: string, data: Buffer) => {
      zip.addBuffer(data, path);
      files.push({ path, bytes: data.length, sha256: sha256(data) });
    };
    const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

    const [company] = await tx
      .select({
        id: companies.id,
        name: companies.name,
        nameLatin: companies.nameLatin,
        createdAt: companies.createdAt,
        archivedAt: companies.archivedAt,
      })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company) throw new Error('No such company');
    add('company.json', json(company));
    const [settings] = await tx
      .select({
        bookCurrency: companySettings.bookCurrency,
        parallelCurrency: companySettings.parallelCurrency,
      })
      .from(companySettings);

    const tables: { name: string; rows: number; json: string; csv: string }[] = [];
    for (const table of EXPORTED_TABLES) {
      const { columns, rows } = await readTable(tx, table);
      add(`tables/${table}.json`, json(rows));
      add(`tables/${table}.csv`, csvOf(columns, rows));
      tables.push({
        name: table,
        rows: rows.length,
        json: `tables/${table}.json`,
        csv: `tables/${table}.csv`,
      });
    }

    const missingAttachments: string[] = [];
    const attachments = await tx
      .select({
        id: entryAttachments.id,
        sha256: entryAttachments.sha256,
        bytes: entryAttachments.sizeBytes,
      })
      .from(entryAttachments)
      .orderBy(asc(entryAttachments.id));
    for (const attachment of attachments) {
      if ((await attachmentFiles.size(attachment.id)) === null) {
        missingAttachments.push(attachment.id);
        continue;
      }
      const path = `attachments/${attachment.id}`;
      // Opened only when the ZIP reaches it: one attachment open at a time, whatever their count.
      zip.addReadStreamLazy(path, { size: attachment.bytes }, (opened) => {
        const stream = verified(attachmentFiles.open(attachment.id), attachment);
        stream.on('error', fail);
        opened(null, stream);
      });
      files.push({ path, bytes: attachment.bytes, sha256: attachment.sha256 });
    }

    const [head] = await tx.select().from(ledgerHeads);
    const [{ exportedAt } = { exportedAt: '' }] = (
      await tx.execute<{ exportedAt: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "exportedAt"`,
      )
    ).rows;
    add('README.md', Buffer.from(README, 'utf8'));
    // The manifest lists every other file; its own digest is the archive's, kept on the export row.
    zip.addBuffer(
      json({
        format: EXPORT_FORMAT,
        exportId,
        companyId,
        companyName: company.name,
        exportedAt,
        ledgers: {
          bookCurrency: settings?.bookCurrency ?? null,
          parallelCurrency: settings?.parallelCurrency ?? null,
        },
        chainHead: {
          entryCount: (head?.entryCount ?? 0n).toString(),
          lastEntryId: head?.lastEntryId ?? null,
          lastHash: head?.lastHash ?? null,
        },
        tables,
        files,
        missingAttachments,
      }),
      'manifest.json',
    );
    zip.end();
  } catch (error) {
    fail(error as Error);
    await writing.catch(() => undefined);
    throw error;
  }
  await writing;
  if (digest === null) throw new Error('The archive ended before it was written');
  return digest;
}
