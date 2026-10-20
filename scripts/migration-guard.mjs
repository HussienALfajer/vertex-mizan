// The migration guard (ADR 0008): fails on SQL that would weaken the ledger and isolation guards.
// Run by CI (`pnpm check:migrations`) over `packages/db/migrations/*.sql`, or over the files and
// folders given as arguments. Tested by `packages/config/test/migration-guard.test.ts`.
//
// It reads the table registry (`packages/db/src/schema/registry.ts`, loaded with Node's type
// stripping) and refuses statements that change or destroy the rows of an append-only table:
// UPDATE, DELETE, TRUNCATE, MERGE or an upsert's DO UPDATE; DROP TABLE, RENAME, SET SCHEMA, a
// dropped column, a column type change, a generated column or expression; inheritance and
// partitions. Run over the default folder, it fails when `packages/db` has no migration,
// keeps one in a subfolder (which it would not read) or has no registry. `--db <dir>` replaces
// `packages/db`.
//
// Comments outside dollar-quoted bodies are ignored. Bodies and string literals are checked as text,
// as PostgreSQL's lexer skips them, so dynamic SQL written out in one unescaped literal is caught.
// Escaped literals (`U&'…'`, `U&"…"`, `E'…'` with `\x`, `\u` or octal escapes) are refused, since
// they could spell a forbidden word. SQL assembled from pieces is not caught: the convention tests
// on the migrated database are the backstop.
// An intended exception needs a new ADR: a comment inside the statement names the rule and the ADR,
// `-- migration-guard: allow drop-policy (ADR 0012)`. The ADR must be `Status: Accepted` and say
// `migration-guard: allow drop-policy` itself. `--decisions <dir>` replaces `docs/decisions/`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A rule that matches a regular expression; returns the offset of the match, or -1. */
const pattern = (regex) => (text) => text.search(regex);

const RULES = [
  {
    id: 'disable-trigger',
    find: pattern(/\bDISABLE\s+TRIGGER\b/i),
    message: 'disables a trigger',
  },
  {
    id: 'enable-trigger',
    // Only `ENABLE ALWAYS TRIGGER` keeps a guard firing under `session_replication_role = replica`.
    find: pattern(/\bENABLE\s+(?:REPLICA\s+)?TRIGGER\b/i),
    message: 'enables a trigger without ALWAYS, so a replica session would skip it',
  },
  { id: 'drop-trigger', find: pattern(/\bDROP\s+TRIGGER\b/i), message: 'drops a trigger' },
  {
    id: 'replace-trigger',
    find: pattern(/\bCREATE\s+OR\s+REPLACE\s+(?:CONSTRAINT\s+)?TRIGGER\b/i),
    message: 'replaces a trigger in place, which can weaken a guard without DROP TRIGGER',
  },
  {
    id: 'create-rule',
    find: pattern(/\bCREATE\s+(?:OR\s+REPLACE\s+)?RULE\b/i),
    message: 'creates a rewrite rule, which can redirect or drop a write that no trigger sees',
  },
  {
    id: 'rename-enum-value',
    find: pattern(/\bALTER\s+TYPE\b[^;]*?\bRENAME\s+VALUE\b/i),
    message: 'renames an enum value, which changes the meaning of every stored row that holds it',
  },
  {
    id: 'drop-owned',
    find: pattern(/\bDROP\s+OWNED\b/i),
    message: 'drops every object a role owns, its tables and guards included',
  },
  {
    id: 'drop-policy',
    find: pattern(/\bDROP\s+POLICY\b/i),
    message: 'drops a row-level security policy',
  },
  {
    id: 'alter-policy',
    find: pattern(/\bALTER\s+POLICY\b/i),
    message: 'changes a row-level security policy',
  },
  {
    id: 'drop-cascade',
    find: pattern(/\bDROP\b[^;]*?\bCASCADE\b/i),
    message: 'drops with CASCADE, which removes dependent triggers and policies silently',
  },
  {
    id: 'no-force-rls',
    find: pattern(/\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i),
    message: 'stops forcing row-level security',
  },
  {
    id: 'disable-rls',
    find: pattern(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i),
    message: 'disables row-level security',
  },
  {
    id: 'alter-owner',
    find: pattern(/\bOWNER\s+TO\b|\bREASSIGN\s+OWNED\b/i),
    message: 'changes an owner',
  },
  {
    id: 'replication-role',
    find: pattern(/\bsession_replication_role\b/i),
    message: 'sets session_replication_role',
  },
  {
    id: 'string-escaping',
    // Turning these off makes a backslash escape a quote in plain strings, which this guard's
    // lexer (and any reader of the file) would misread.
    find: pattern(/\b(?:standard_conforming_strings|backslash_quote)\b/i),
    message: 'changes how strings are escaped',
  },
  {
    id: 'escaped-literal',
    find: pattern(/\bU&['"]|\bE'(?:[^'\\]|''|\\[^xuU0-7])*\\[xuU0-7]/i),
    message: 'uses an escaped literal (U& or an E string with a code escape), which can hide SQL',
  },
  { id: 'bypass-rls', find: pattern(/\bBYPASSRLS\b/i), message: 'grants BYPASSRLS' },
  {
    id: 'security-definer',
    find: pattern(/\bSECURITY\s+DEFINER\b/i),
    message: 'creates a SECURITY DEFINER function',
  },
  {
    id: 'grant-forbidden',
    // ADR 0003: no role gets TRUNCATE, TRIGGER or REFERENCES; ALL would include them.
    find: (text) => {
      for (const match of text.matchAll(/\bGRANT\s+([\s\S]*?)\s+ON\b/gi)) {
        if (/\b(?:TRUNCATE|TRIGGER|REFERENCES|ALL)\b/i.test(match[1] ?? '')) return match.index;
      }
      return -1;
    },
    message: 'grants TRUNCATE, TRIGGER, REFERENCES or ALL',
  },
];

// A table name as a statement may write it: optionally ONLY and schema-qualified, quoted or not.
const NAME = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)';
const TABLE = String.raw`(?:ONLY\s+)?(?:${NAME}\s*\.\s*)?(${NAME})\s*\*?`;
const TABLES = String.raw`${TABLE}(?:\s*,\s*${TABLE})*`;

/** The table a name refers to: quoted names keep their case, others are folded to lower case. */
const tableName = (name) =>
  name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name.toLowerCase();

/** The offset of the first match of `regex` whose captured table list names an append-only table. */
function namesAppendOnly(text, regex, appendOnly) {
  for (const match of text.matchAll(regex)) {
    const list = match.groups?.tables ?? '';
    for (const [, name] of list.matchAll(new RegExp(TABLE, 'gi'))) {
      if (appendOnly.has(tableName(name ?? ''))) return match.index;
    }
  }
  return -1;
}

/** The rules that need the registry's append-only tables (ADR 0005: no migration changes them). */
function registryRules(appendOnly) {
  const writes = [
    new RegExp(String.raw`\bUPDATE\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(String.raw`\bDELETE\s+FROM\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?<tables>${TABLES})`, 'gi'),
    new RegExp(String.raw`\bMERGE\s+INTO\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(
      String.raw`\bINSERT\s+INTO\s+(?<tables>${TABLE})(?=[^;]*\bON\s+CONFLICT\b[^;]*\bDO\s+UPDATE\b)`,
      'gi',
    ),
  ];
  // Each lookahead stops at the end of the command, so a function body's later commands are not
  // read as part of it.
  const rewrites = [
    new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?<tables>${TABLES})`, 'gi'),
    new RegExp(
      String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?<tables>${TABLE})(?=[^;]*(?:` +
        String.raw`\bDROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(?!(?:CONSTRAINT|DEFAULT|NOT|IDENTITY|EXPRESSION)\b)${NAME}` +
        String.raw`|\bALTER\s+(?:COLUMN\s+)?${NAME}\s+(?:SET\s+DATA\s+)?TYPE\b` +
        String.raw`|\bRENAME\b|\bSET\s+SCHEMA\b|\bSET\s+EXPRESSION\b|\bGENERATED\b` +
        String.raw`|\b(?:ATTACH|DETACH)\s+PARTITION\b|\bINHERIT\b))`,
      'gi',
    ),
    new RegExp(String.raw`\b(?:ATTACH|DETACH)\s+PARTITION\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(String.raw`\bPARTITION\s+OF\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(String.raw`\bINHERIT\s+(?<tables>${TABLE})`, 'gi'),
    new RegExp(String.raw`\bINHERITS\s*\(\s*(?<tables>${TABLES})\s*\)`, 'gi'),
  ];
  const first = (offsets) =>
    offsets.filter((offset) => offset !== -1).sort((a, b) => a - b)[0] ?? -1;
  return [
    {
      id: 'append-only-write',
      find: (text) => first(writes.map((regex) => namesAppendOnly(text, regex, appendOnly))),
      message:
        'changes the rows of an append-only table (UPDATE, DELETE, TRUNCATE, MERGE or DO UPDATE)',
    },
    {
      id: 'append-only-rewrite',
      find: (text) => first(rewrites.map((regex) => namesAppendOnly(text, regex, appendOnly))),
      message:
        'drops, renames, moves or rewrites an append-only table or its columns, or joins it to ' +
        'another through inheritance or partitions, where no trigger fires',
    },
  ];
}

// What PostgreSQL accepts inside an identifier: a quote after one of these is part of the name.
const IDENTIFIER = /[A-Za-z0-9_$\u0080-\uffff]/;

const MARKER = /migration-guard:\s*allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*\(ADR\s*(\d{4})\)/gi;

/**
 * Splits SQL into statements as PostgreSQL's lexer does. Returns each statement's start in the
 * source, its text with every comment blanked out (same length, newlines kept, so offsets map to
 * the source), and its comments.
 */
function statements(sql) {
  const masked = sql.split('');
  const result = [];
  let start = 0;
  let comments = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (masked[k] !== '\n') masked[k] = ' ';
  };

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i);
      const end = newline === -1 ? sql.length : newline;
      comments.push(sql.slice(i, end));
      blank(i, end);
      i = end;
    } else if (char === '/' && next === '*') {
      let depth = 1;
      let k = i + 2;
      while (k < sql.length && depth > 0) {
        if (sql[k] === '/' && sql[k + 1] === '*') {
          depth++;
          k += 2;
        } else if (sql[k] === '*' && sql[k + 1] === '/') {
          depth--;
          k += 2;
        } else {
          k++;
        }
      }
      comments.push(sql.slice(i, k));
      blank(i, k);
      i = k;
    } else if (char === "'") {
      // `E'…'` strings take backslash escapes; every string doubles a quote to escape it.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !IDENTIFIER.test(sql[i - 2] ?? '');
      let k = i + 1;
      while (k < sql.length) {
        if (escapes && sql[k] === '\\') k += 2;
        else if (sql[k] === "'" && sql[k + 1] === "'") k += 2;
        else if (sql[k] === "'") break;
        else k++;
      }
      i = k + 1;
    } else if (char === '"') {
      let k = i + 1;
      while (k < sql.length && !(sql[k] === '"' && sql[k + 1] !== '"')) k += sql[k] === '"' ? 2 : 1;
      i = k + 1;
    } else if (char === '$') {
      // A dollar-quoted body ends at the first copy of its tag; nothing inside is lexed.
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (!tag || IDENTIFIER.test(sql[i - 1] ?? '')) {
        i++;
      } else {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
      }
    } else if (char === ';') {
      result.push({ start, text: masked.slice(start, i).join(''), comments });
      start = i + 1;
      comments = [];
      i++;
    } else {
      i++;
    }
  }
  if (sql.slice(start).trim()) {
    result.push({ start, text: masked.slice(start).join(''), comments });
  }
  return result;
}

const lineOf = (sql, offset) => sql.slice(0, offset).split('\n').length;

/** Why an exception naming `adr` cannot allow `rule`, or '' when it can. */
function refusal(decisions, adr, rule) {
  const file = existsSync(decisions)
    ? readdirSync(decisions).find((name) => name.startsWith(`${adr}-`) && name.endsWith('.md'))
    : undefined;
  if (!file) return `ADR ${adr} does not exist`;
  const text = readFileSync(join(decisions, file), 'utf8');
  if (!/^Status:\s*Accepted\b/m.test(text)) return `ADR ${adr} is not accepted`;
  if (!text.includes(`migration-guard: allow ${rule}`)) {
    return `ADR ${adr} does not say \`migration-guard: allow ${rule}\``;
  }
  return '';
}

/** Findings for one SQL file: `{ line, rule, message }`. */
function check(sql, decisions, rules) {
  const findings = [];
  for (const statement of statements(sql)) {
    const first = statement.start + statement.text.search(/\S/);
    const allowed = new Set();
    for (const comment of statement.comments) {
      for (const [, rules, adr] of comment.matchAll(MARKER)) {
        for (const rule of rules.split(',').map((r) => r.trim().toLowerCase())) {
          const reason = refusal(decisions, adr, rule);
          if (reason) {
            findings.push({
              line: lineOf(sql, first),
              rule: 'exception-refused',
              message: `the exception for ${rule} is refused: ${reason}`,
            });
          } else {
            allowed.add(rule);
          }
        }
      }
    }
    for (const rule of rules) {
      const offset = rule.find(statement.text);
      if (offset !== -1 && !allowed.has(rule.id)) {
        findings.push({
          line: lineOf(sql, statement.start + offset),
          rule: rule.id,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

function sqlFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(target, name));
}

/** The `.sql` files in the subfolders of `folder`, at any depth. */
function nestedSqlFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => resolve(file, '..') !== resolve(folder))
    .sort();
}

const show = (path) => relative(process.cwd(), path).replaceAll('\\', '/') || '.';

/** Takes `--flag <value>` out of `args`; returns the resolved value or the fallback. */
function option(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : resolve(args.splice(index, 2)[1] ?? '');
}

const args = process.argv.slice(2);
const decisions = option(args, '--decisions', join(root, 'docs', 'decisions'));
const db = option(args, '--db', join(root, 'packages', 'db'));
const migrations = join(db, 'migrations');
const registry = join(db, 'src', 'schema', 'registry.ts');

// Problems of the layout, each `{ path, rule, message }`.
const problems = [];
let appendOnly = new Set();
if (existsSync(db)) {
  if (existsSync(registry)) {
    const { tableRegistry } = await import(pathToFileURL(registry).href);
    appendOnly = new Set(
      Object.entries(tableRegistry ?? {})
        .filter(([, info]) => info?.kind === 'append-only')
        .map(([name]) => name),
    );
  } else {
    problems.push({
      path: registry,
      rule: 'no-registry',
      message: 'the table registry is missing, so append-only tables cannot be protected',
    });
  }
}

let files;
if (args.length > 0) {
  files = args.map((target) => resolve(target)).flatMap(sqlFiles);
} else {
  files = existsSync(db) ? sqlFiles(migrations) : [];
  if (existsSync(db) && files.length === 0) {
    problems.push({ path: migrations, rule: 'no-migrations', message: 'no migration found' });
  }
  for (const file of nestedSqlFiles(migrations)) {
    problems.push({
      path: file,
      rule: 'nested-migration',
      message: 'a migration in a subfolder, which this guard does not read',
    });
  }
}

const rules = [...RULES, ...registryRules(appendOnly)];
let failed = problems.length;
for (const problem of problems) {
  process.stderr.write(`${show(problem.path)}  ${problem.rule}  ${problem.message}
`);
}
for (const file of files) {
  for (const finding of check(readFileSync(file, 'utf8'), decisions, rules)) {
    failed++;
    process.stderr.write(`${show(file)}:${finding.line}  ${finding.rule}  ${finding.message}
`);
  }
}

if (failed > 0) {
  process.stderr.write(
    `\nMigration guard: ${failed} finding(s) (ADR 0008). An intended exception needs a new ADR ` +
      'and a `-- migration-guard: allow <rule> (ADR NNNN)` comment in the statement.\n',
  );
  process.exit(1);
}
process.stdout.write(
  `Migration guard: ${files.length} file(s) checked, nothing weakens a guard.\n`,
);
