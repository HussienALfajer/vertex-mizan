import { createHash } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import {
  companies,
  entryAttachments,
  ledgerHeads,
  type Transaction,
  tableRegistry,
} from '@vertex-mizan/db';
import { asc, eq, sql } from 'drizzle-orm';
import { ZipFile } from 'yazl';

// The full export's archive (S03 rule 21): every company table as JSON and CSV, the attachments'
// files, a manifest with the row counts, every file's SHA-256 and the chain head, and a README in
// Arabic and English. Read inside the caller's company context and snapshot.

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
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const README = `# تصدير بيانات الشركة من ميزان · Mizan company export

## بالعربية
هذا الملف تصدير كامل لبيانات شركة واحدة من ميزان، أُخذ من لقطة واحدة متسقة لقاعدة البيانات.
- \`company.json\`: بيانات الشركة.
- \`tables/<الجدول>.json\` و\`tables/<الجدول>.csv\`: كل جدول من جداول الشركة بصيغتين (الإعدادات، دليل الحسابات، الأبعاد، الأسعار، القيود وأسطرها وتحويلاتها، مجموعات الأبعاد، المسودات، بيانات المرفقات، الفترات وأرصدتها، مراسي السلسلة، سجل التدقيق).
- \`attachments/<المعرّف>\`: ملفات المرفقات، وأسماؤها الأصلية وأنواعها في \`tables/entry_attachments\`.
- \`manifest.json\`: الجداول وعدد صفوفها، وبصمة SHA-256 لكل ملف، ورأس سلسلة القيود.
المبالغ أعداد صحيحة بأصغر وحدة للعملة (القرش أو السنت) مكتوبة نصًا مع رمز عملتها، والأسعار كما سُجّلت، والأوقات بتوقيت UTC. في ملفات CSV يسبق نصًّا يبدأ بعلامة قد يعدّها برنامج الجداول صيغة (= أو + أو @ أو - ليست عددًا) علامةُ '.

## English
A full export of one company's data from Mizan, read from one consistent snapshot of the database.
- \`company.json\`: the company.
- \`tables/<table>.json\` and \`tables/<table>.csv\`: every company table in both forms (settings, chart of accounts, dimensions, rates, entries with their lines and conversions, dimension sets, drafts, attachments' metadata, periods and period balances, chain anchors, the audit log).
- \`attachments/<id>\`: the attachments' files; their names and types are in \`tables/entry_attachments\`.
- \`manifest.json\`: the tables and their row counts, every file's SHA-256 and the chain head.
Amounts are integers in minor units of their currency, written as strings beside their currency code; rates as recorded; times in UTC. In the CSV files, text a spreadsheet would read as a formula (starting with =, +, @ or a - that is not a number) is prefixed with '.
`;

/** What the archive holds, for the manifest and the row it completes. */
export interface ArchiveFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * The archive of `companyId`'s data as a ZIP stream, built from `tx` (the company's context, a
 * repeatable-read snapshot); `readAttachment` reads an attachment's file, or null when it is gone,
 * which the manifest lists. The stream's `done` gives the ZIP's size and SHA-256 once it ends.
 */
export async function buildArchive(
  tx: Transaction,
  companyId: string,
  exportId: string,
  readAttachment: (id: string) => Promise<Buffer | null>,
): Promise<{ stream: Readable; done: Promise<{ size: number; sha256: string }> }> {
  const zip = new ZipFile();
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
    .select({ id: entryAttachments.id })
    .from(entryAttachments)
    .orderBy(asc(entryAttachments.id));
  for (const { id } of attachments) {
    const file = await readAttachment(id);
    if (file === null) missingAttachments.push(id);
    else add(`attachments/${id}`, file);
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

  // Counts and hashes the ZIP as it passes, without reading it ahead of its consumer.
  const hash = createHash('sha256');
  let size = 0;
  let finished: (result: { size: number; sha256: string }) => void = () => {};
  const done = new Promise<{ size: number; sha256: string }>((resolve) => {
    finished = resolve;
  });
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, next) {
      hash.update(chunk);
      size += chunk.length;
      next(null, chunk);
    },
    flush(next) {
      finished({ size, sha256: hash.digest('hex') });
      next();
    },
  });
  zip.outputStream.on('error', (error) => counted.destroy(error));
  zip.outputStream.pipe(counted);
  return { stream: counted, done };
}
