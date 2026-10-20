import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { caseSchema, type ScenarioCase } from './format.js';

/** The areas of `docs/scenarios/<area>/<rule>.md` (`docs/scenarios/README.md`, Layout). */
export const AREAS = [
  'receivables',
  'revenue',
  'ad-funds',
  'expenses',
  'currency',
  'periods',
  'opening',
  'manual',
] as const;

/** `Proposed` cases are skipped and reported; only `Approved` ones run and count (ADR 0008). */
export type ScenarioStatus = { status: 'proposed' } | { status: 'approved'; approvedOn: string };

export type ScenarioFile = {
  /** From the repository root, with forward slashes: `docs/scenarios/<area>/<rule>.md`. */
  path: string;
  title: string;
  status: ScenarioStatus;
  cases: ScenarioCase[];
};

export type Book = { files: ScenarioFile[]; errors: string[] };

export class ScenarioFormatError extends Error {
  constructor(
    readonly path: string,
    readonly problems: readonly string[],
  ) {
    super(`${path}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ScenarioFormatError';
  }
}

const STATUS = /^Status: (?:Proposed|Approved \(owner, (\d{4}-\d{2}-\d{2})\))$/;

/** A closing fence: the opening one's character, at least as many, indented up to three spaces. */
function closes(marks: string, text: string): boolean {
  const fence = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text)?.[1];
  return fence !== undefined && fence[0] === marks[0] && fence.length >= marks.length;
}

/**
 * Every fenced `yaml` block of a Markdown file, with the line its fence opens on. A case is fenced
 * exactly `` ```yaml `` at the start of a line. Any fence that would hide one is a problem, never
 * skipped: one indented or of tildes or of more backticks, an info string such as `yml`, `YAML` or
 * `yaml title`, and a fence never closed. Fences close as in CommonMark, so scanning goes on.
 */
export function yamlBlocks(markdown: string): {
  blocks: { line: number; source: string }[];
  problems: string[];
} {
  const blocks: { line: number; source: string }[] = [];
  const problems: string[] = [];
  let open: { line: number; yaml: boolean; marks: string; lines: string[] } | null = null;
  for (const [index, text] of markdown.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (open === null) {
      const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
      if (!fence) continue;
      const [, indent = '', marks = '', info = ''] = fence;
      const regular = indent === '' && marks === '```';
      const yaml = info.trim() === 'yaml';
      if (!regular) {
        problems.push(`Line ${line}: a fence is three backticks at the start of the line`);
      } else if (!yaml && /^ya?ml\b/i.test(info.trim())) {
        problems.push(`Line ${line}: a case is fenced exactly \`\`\`yaml`);
      }
      open = { line, yaml: regular && yaml, marks, lines: [] };
    } else if (closes(open.marks, text)) {
      if (open.yaml) blocks.push({ line: open.line, source: open.lines.join('\n') });
      open = null;
    } else {
      open.lines.push(text);
    }
  }
  if (open !== null) problems.push(`Line ${open.line}: the fence is never closed`);
  return { blocks, problems };
}

/**
 * One case from its YAML. Integers are read as `bigint`, so no amount passes through a float; the
 * YAML 1.2 core schema leaves dates as strings; a repeated key is an error.
 */
export function parseCase(source: string): ScenarioCase {
  const value: unknown = parse(source, { intAsBigInt: true, uniqueKeys: true, strict: true });
  return caseSchema.parse(value);
}

function problemOf(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error).replaceAll('\n', '\n    ');
  return error instanceof Error ? error.message : String(error);
}

/** A scenario file: its title, its status line and every YAML block as one case. */
export function parseScenario(path: string, markdown: string): ScenarioFile {
  const problems: string[] = [];
  const lines = markdown.split(/\r?\n/);

  const title =
    lines
      .find((line) => line.startsWith('# '))
      ?.slice(2)
      .trim() ?? '';
  if (title === '') problems.push('No title: the file starts with a "# " heading');

  let status: ScenarioStatus | null = null;
  const statusLines = lines.filter((line) => line.startsWith('Status:'));
  if (statusLines.length !== 1) {
    problems.push(`Expected one status line, found ${statusLines.length}`);
  } else {
    const match = STATUS.exec(statusLines[0]?.trimEnd() ?? '');
    const approvedOn = match?.[1];
    if (!match) {
      problems.push('Expected "Status: Proposed" or "Status: Approved (owner, YYYY-MM-DD)"');
    } else if (approvedOn === undefined) {
      status = { status: 'proposed' };
    } else if (!z.iso.date().safeParse(approvedOn).success) {
      problems.push(`The approval date ${approvedOn} is not a date`);
    } else {
      status = { status: 'approved', approvedOn };
    }
  }

  const cases: ScenarioCase[] = [];
  const { blocks, problems: fences } = yamlBlocks(markdown);
  problems.push(...fences);
  if (blocks.length === 0) problems.push('No case: a scenario has at least one yaml block');
  for (const block of blocks) {
    try {
      cases.push(parseCase(block.source));
    } catch (error) {
      problems.push(`The case at line ${block.line}: ${problemOf(error)}`);
    }
  }
  const names = cases.map((scenarioCase) => scenarioCase.name);
  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    problems.push(`Two cases are named "${name}"`);
  }

  if (problems.length > 0 || status === null) throw new ScenarioFormatError(path, problems);
  return { path, title, status, cases };
}

/**
 * Every scenario file under `docs/scenarios` of the repository, in path order. A file that breaks
 * the format, or any file outside `<area>/<rule>.md` (another extension included), is an error;
 * `README.md` is the format itself.
 */
export function readBook(repositoryRoot: string): Book {
  const root = join(repositoryRoot, 'docs', 'scenarios');
  const files: ScenarioFile[] = [];
  const errors: string[] = [];
  const names = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((name) => name !== 'README.md')
    .sort();
  for (const name of names) {
    const path = relative(repositoryRoot, join(root, name)).split(sep).join('/');
    const [area, rule, ...deeper] = name.split('/');
    if (
      !(AREAS as readonly (string | undefined)[]).includes(area) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(rule ?? '') ||
      deeper.length > 0
    ) {
      errors.push(
        `${path}: expected docs/scenarios/<area>/<rule>.md, the area one of ${AREAS.join(', ')}`,
      );
      continue;
    }
    try {
      files.push(parseScenario(path, readFileSync(join(root, name), 'utf8')));
    } catch (error) {
      errors.push(
        error instanceof ScenarioFormatError ? error.message : `${path}: ${problemOf(error)}`,
      );
    }
  }
  return { files, errors };
}
