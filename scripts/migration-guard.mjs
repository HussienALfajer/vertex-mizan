// The migration guard (ADR 0008): fails on SQL that would weaken the ledger and isolation guards.
// Run by CI (`pnpm check:migrations`) over `packages/db/migrations/*.sql`, or over the files and
// folders given as arguments. Tested by `packages/config/test/migration-guard.test.ts`.
//
// Comments are ignored; string literals are checked too, so dynamic SQL (`EXECUTE '…'`) is caught.
// An intended exception needs a new ADR: a comment inside the statement names the rule and the
// accepted ADR that allows it, `-- migration-guard: allow drop-policy (ADR 0012)`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const decisions = join(root, 'docs', 'decisions');
const defaultTarget = join(root, 'packages', 'db', 'migrations');

const RULES = [
  {
    id: 'disable-trigger',
    pattern: /\bDISABLE\s+TRIGGER\b/i,
    message: 'disables a trigger',
  },
  {
    id: 'enable-trigger',
    // Only `ENABLE ALWAYS TRIGGER` keeps a guard firing under `session_replication_role = replica`.
    pattern: /\bENABLE\s+(?:REPLICA\s+)?TRIGGER\b/i,
    message: 'enables a trigger without ALWAYS, so a replica session would skip it',
  },
  { id: 'drop-trigger', pattern: /\bDROP\s+TRIGGER\b/i, message: 'drops a trigger' },
  {
    id: 'drop-policy',
    pattern: /\bDROP\s+POLICY\b/i,
    message: 'drops a row-level security policy',
  },
  {
    id: 'alter-policy',
    pattern: /\bALTER\s+POLICY\b/i,
    message: 'changes a row-level security policy',
  },
  {
    id: 'drop-cascade',
    pattern: /\bDROP\b[^;]*?\bCASCADE\b/i,
    message: 'drops with CASCADE, which removes dependent triggers and policies silently',
  },
  {
    id: 'no-force-rls',
    pattern: /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
    message: 'stops forcing row-level security',
  },
  {
    id: 'disable-rls',
    pattern: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
    message: 'disables row-level security',
  },
  {
    id: 'alter-owner',
    pattern: /\bOWNER\s+TO\b|\bREASSIGN\s+OWNED\b/i,
    message: 'changes an owner',
  },
  {
    id: 'replication-role',
    pattern: /\bsession_replication_role\b/i,
    message: 'sets session_replication_role',
  },
  { id: 'bypass-rls', pattern: /\bBYPASSRLS\b/i, message: 'grants BYPASSRLS' },
  {
    id: 'security-definer',
    pattern: /\bSECURITY\s+DEFINER\b/i,
    message: 'creates a SECURITY DEFINER function',
  },
];

const MARKER = /migration-guard:\s*allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*\(ADR\s*(\d{4})\)/gi;

/**
 * Splits SQL into statements. Returns each statement's range in the source, its text with every
 * comment blanked out (same length, newlines kept, so offsets map to the source), and its comments.
 */
function statements(sql) {
  const masked = sql.split('');
  const result = [];
  const tags = []; // open dollar quotes, innermost last
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
      const end = sql.indexOf('\n', i) === -1 ? sql.length : sql.indexOf('\n', i);
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
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (!tag || /\w/.test(sql[i - 1] ?? '')) {
        i++;
      } else {
        if (tags.at(-1) === tag) tags.pop();
        else tags.push(tag);
        i += tag.length;
      }
    } else if (char === ';' && tags.length === 0) {
      result.push({ start, end: i, text: masked.slice(start, i).join(''), comments });
      start = i + 1;
      comments = [];
      i++;
    } else {
      i++;
    }
  }
  if (sql.slice(start).trim()) {
    result.push({ start, end: sql.length, text: masked.slice(start).join(''), comments });
  }
  return result;
}

const lineOf = (sql, offset) => sql.slice(0, offset).split('\n').length;

function adrExists(number) {
  return existsSync(decisions) && readdirSync(decisions).some((f) => f.startsWith(`${number}-`));
}

/** Findings for one SQL file: `{ line, rule, message }`. */
function check(sql) {
  const findings = [];
  for (const statement of statements(sql)) {
    const allowed = new Set();
    for (const comment of statement.comments) {
      for (const [, rules, adr] of comment.matchAll(MARKER)) {
        if (!adrExists(adr)) {
          findings.push({
            line: lineOf(sql, statement.start + statement.text.search(/\S/)),
            rule: 'unknown-adr',
            message: `the exception names ADR ${adr}, which does not exist in docs/decisions/`,
          });
          continue;
        }
        for (const rule of rules.split(',')) allowed.add(rule.trim().toLowerCase());
      }
    }
    for (const rule of RULES) {
      const match = rule.pattern.exec(statement.text);
      if (match && !allowed.has(rule.id)) {
        findings.push({
          line: lineOf(sql, statement.start + match.index),
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

const targets = process.argv.slice(2);
const files = (targets.length > 0 ? targets.map((t) => resolve(t)) : [defaultTarget]).flatMap(
  sqlFiles,
);

let failed = 0;
for (const file of files) {
  for (const finding of check(readFileSync(file, 'utf8'))) {
    failed++;
    const path = relative(process.cwd(), file).replaceAll('\\', '/');
    process.stderr.write(`${path}:${finding.line}  ${finding.rule}  ${finding.message}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(
    `\nMigration guard: ${failed} guard-weakening statement(s) (ADR 0008). An intended exception ` +
      'needs a new ADR and a `-- migration-guard: allow <rule> (ADR NNNN)` comment in the statement.\n',
  );
  process.exit(1);
}
process.stdout.write(
  `Migration guard: ${files.length} file(s) checked, nothing weakens a guard.\n`,
);
