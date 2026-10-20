// The migration guard (ADR 0008): fails on SQL that would weaken the ledger and isolation guards.
// Run by CI (`pnpm check:migrations`) over `packages/db/migrations/*.sql`, or over the files and
// folders given as arguments. Tested by `packages/config/test/migration-guard.test.ts`.
//
// Comments outside dollar-quoted bodies are ignored. Bodies and string literals are checked as text,
// as PostgreSQL's lexer skips them, so dynamic SQL written out in one literal is caught; SQL
// assembled from pieces is not, and the convention tests on the migrated database are the backstop.
// An intended exception needs a new ADR: a comment inside the statement names the rule and the ADR,
// `-- migration-guard: allow drop-policy (ADR 0012)`. The ADR must be `Status: Accepted` and say
// `migration-guard: allow drop-policy` itself. `--decisions <dir>` replaces `docs/decisions/`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultTarget = join(root, 'packages', 'db', 'migrations');

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
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/\w/.test(sql[i - 2] ?? '');
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
      if (!tag || /\w/.test(sql[i - 1] ?? '')) {
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
function check(sql, decisions) {
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
    for (const rule of RULES) {
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

const args = process.argv.slice(2);
const decisionsFlag = args.indexOf('--decisions');
const decisions =
  decisionsFlag === -1
    ? join(root, 'docs', 'decisions')
    : resolve(args.splice(decisionsFlag, 2)[1] ?? '');
const files = (args.length > 0 ? args.map((t) => resolve(t)) : [defaultTarget]).flatMap(sqlFiles);

let failed = 0;
for (const file of files) {
  for (const finding of check(readFileSync(file, 'utf8'), decisions)) {
    failed++;
    const path = relative(process.cwd(), file).replaceAll('\\', '/');
    process.stderr.write(`${path}:${finding.line}  ${finding.rule}  ${finding.message}\n`);
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
