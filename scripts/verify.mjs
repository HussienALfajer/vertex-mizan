// The one check command for agents and people (docs/testing.md). Each check runs once, its whole
// output goes to a log file in .verify/, and the console gets a short summary of what failed.
// Adapted from Vertex Hub's scripts/verify.mjs.
//
//   pnpm verify                 lint; typecheck, test, build and the scenario book of every package
//                               (Turborepo replays what did not change); the migration drift and
//                               guard when the schema's sources changed; the error-code guard; the
//                               OpenAPI guard when the API changed; the E2E specs the branch changed
//   pnpm verify <files...>      only these test files: Vitest in their package (a file under
//                               docs/scenarios/ runs the scenario book), Playwright for a spec under
//                               apps/<app>/e2e/ (with --grep <pattern> to pick tests)
//   --e2e-all                   every app's whole E2E suite instead of the changed specs (CI runs
//                               them; here they take minutes)
//   --base <ref>                compare with <ref> instead of the merge base with origin/main
//   --allow-dev                 run although a dev server is up (the build replaces the dist it runs)
//
// The database tests and the scenario book need the URLs of .env (.env.example); the Vitest configs
// load it. Exit code: 0 when everything passed, 1 when a check failed, 3 when it refused to start.
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, '.verify');
const lockFile = join(tmpdir(), 'vertex-mizan-verify.lock');
// Longer than any real run (`--e2e-all` included): past it, the lock is a leftover.
const LOCK_MAX_AGE_MS = 30 * 60_000;
// The built API (`pnpm --filter @vertex-mizan/api start`) and Vite's dev server (apps/web).
const DEV_PORTS = [3300, 5173];
// An E2E spec: apps/<app>/e2e/**/*.spec.ts, run by that app's Playwright.
const E2E_SPEC = /^(apps\/[\w-]+)\/e2e\/.+\.spec\.ts$/;
// The scenario book is one Vitest file with its own config; the Markdown it reads is its input.
const SCENARIOS = { dir: 'packages/scenarios', config: 'vitest.scenarios.config.ts' };
const SCENARIO_BOOK = /^(docs\/scenarios\/|packages\/scenarios\/test\/scenario-book\.test\.ts$)/;
// What the summary keeps from a log: Biome diagnostics; failed tests, assertions, type errors.
const LINT_LINES = /^\S+:\d+:\d+ |^Found \d+ (error|warning)/;
const TASK_LINES =
  /(^| )(FAIL|×) |AssertionError|Error:|error TS\d+|❯ \S+:\d+:\d+|Test Files .*failed|expected .+ to /;
const RERUN_FILE = /\b(?:apps|packages)\/[\w-]+\/[\w./-]+\.(?:test|spec)\.tsx?\b/g;

const options = parseArgs(process.argv.slice(2));
const started = Date.now();
const report = [];
let failed = false;

takeLock();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const base = options.base ?? defaultBase();
const changed = changedFiles(base);
const packages = workspacePackages();

if (options.files.length > 0) {
  await verifyFiles(options.files);
} else {
  await verifyBranch();
}
finish();

/** Lint, the whole task graph, the guards, and the changed E2E specs. */
async function verifyBranch() {
  if (!options.allowDev) {
    const busy = [];
    for (const port of DEV_PORTS) if (await listening(port)) busy.push(port);
    if (busy.length > 0) {
      refuse(
        `A dev server is running (port ${busy.join(', ')}). Stop it first: the build replaces the ` +
          'dist folder it runs from. Or pass --allow-dev.',
      );
    }
  }
  report.push(
    `base ${base.slice(0, 7)}, ${changed.length} changed file${changed.length === 1 ? '' : 's'}`,
  );

  const lint = await run('lint', process.execPath, [
    bin(root, '@biomejs/biome', 'biome'),
    'check',
    '--error-on-warnings',
    '--colors=off',
    '.',
  ]);
  section('lint', lint, lint.code === 0 ? [] : pick(read(lint.log), LINT_LINES, 20));

  const graph = await run('turbo', process.execPath, [
    bin(root, 'turbo'),
    'run',
    'typecheck',
    'test',
    'build',
    'test:scenarios',
    '--continue',
    '--output-logs=errors-only',
    '--summarize',
  ]);
  const tasks = turboTasks(read(graph.log));
  const ran = tasks.filter((task) => task.status === 'MISS');
  const broken = tasks.filter((task) => task.exitCode !== 0);
  const details = [
    `${tasks.length} tasks: ${tasks.length - ran.length} replayed from the cache, ${ran.length} ran` +
      (ran.length > 0
        ? ` (${ran.map((task) => `${task.id} ${seconds(task.ms)}`).join(', ')})`
        : ''),
  ];
  const book = tasks.find((task) => task.id.endsWith('#test:scenarios'));
  if (book) details.push(`scenario book: ${scenarioCount(book.log)}`);
  for (const task of broken) {
    details.push(`FAIL ${task.id}: ${task.logFile}`);
    details.push(...pick(task.log, TASK_LINES, 14).map((line) => `  ${line}`));
    // Vitest names failed files from its package; the rerun line needs them from the root.
    const dir = packages.find((pkg) => task.id.startsWith(`${pkg.name}#`))?.dir;
    const files = new Set(
      [...task.log.matchAll(/\bFAIL\s+(\S+\.(?:test|spec)\.tsx?)\b/g)].map(
        (match) => `${dir}/${match[1]}`,
      ),
    );
    if (dir && files.size > 0) details.push(`  failed files: ${[...files].join(' ')}`);
  }
  section('typecheck, test, build, scenario book', graph, details);
  const built = (app) => !broken.some((task) => task.id === `${packageName(app)}#build`);

  if (
    changed.some((file) =>
      /^(packages\/db\/(src|migrations)|packages\/contracts\/src)\//.test(file),
    )
  ) {
    await migrationDrift();
    const guard = await run('check-migrations', process.execPath, ['scripts/migration-guard.mjs']);
    section('migration guard', guard, guard.code === 0 ? [] : pick(read(guard.log), /\S/, 12));
  }

  const codes = await run('check-error-codes', process.execPath, [
    'scripts/error-codes-guard.mjs',
    '--base',
    base,
  ]);
  section('error-code guard', codes, codes.code === 0 ? [] : pick(read(codes.log), /\S/, 12));

  if (changed.some((file) => /^(apps\/api|packages\/contracts\/src)\//.test(file))) {
    await openApiGuard();
  }

  const specs = changed.filter((file) => E2E_SPEC.test(file) && existsSync(join(root, file)));
  const apps = options.e2eAll ? e2eApps() : [...new Set(specs.map((file) => appOf(file)))];
  if (apps.length === 0) {
    report.push(
      options.e2eAll
        ? 'e2e: no app has an E2E suite yet'
        : 'e2e: no changed spec (CI runs them all)',
    );
  }
  for (const app of apps) {
    if (!built(app)) {
      report.push(`e2e ${app}: skipped, its build failed`);
    } else {
      await e2e(app, options.e2eAll ? [] : specs.filter((file) => appOf(file) === app));
    }
  }
}

/** Only the given test files (paths from the repository root), after building their dependencies. */
async function verifyFiles(files) {
  const byPackage = new Map();
  const specs = new Map();
  let scenarioBook = false;
  for (const file of files) {
    const path = relative(root, resolve(root, file)).replaceAll('\\', '/');
    if (path.startsWith('..') || !existsSync(join(root, path))) refuse(`No such file: ${file}`);
    if (SCENARIO_BOOK.test(path)) {
      scenarioBook = true;
      continue;
    }
    if (E2E_SPEC.test(path)) {
      const app = appOf(path);
      if (!specs.has(app)) specs.set(app, []);
      specs.get(app).push(path);
      continue;
    }
    const owner = packages.find((pkg) => path.startsWith(`${pkg.dir}/`));
    if (!owner) refuse(`${file} is not inside a workspace package.`);
    if (!byPackage.has(owner)) byPackage.set(owner, []);
    byPackage.get(owner).push(path.slice(owner.dir.length + 1));
  }
  for (const [pkg, tests] of byPackage) {
    await vitest(pkg, tests);
  }
  if (scenarioBook) {
    const pkg = packages.find((candidate) => candidate.dir === SCENARIOS.dir);
    await vitest(pkg, [], { config: SCENARIOS.config, label: 'scenario book' });
  }
  for (const [app, appSpecs] of specs) {
    const build = await run(`build-${short(app)}`, process.execPath, [
      bin(root, 'turbo'),
      'run',
      'build',
      `--filter=${packageName(app)}`,
      '--output-logs=errors-only',
    ]);
    if (build.code === 0) await e2e(app, appSpecs, { grep: options.grep });
    else section(`e2e ${app}: build`, build, pick(read(build.log), TASK_LINES, 14));
  }
}

/** Vitest on some files of one package (all of them when empty), after building its dependencies. */
async function vitest(pkg, tests, { config, label } = {}) {
  const name = short(pkg.dir);
  const deps = await run(`build-${name}`, process.execPath, [
    bin(root, 'turbo'),
    'run',
    'build',
    `--filter=${pkg.name}^...`,
    '--output-logs=errors-only',
  ]);
  if (deps.code !== 0) {
    section(`${name}: build of its dependencies`, deps, pick(read(deps.log), TASK_LINES, 14));
    return;
  }
  const json = join(out, `vitest-${name}.json`);
  const result = await run(
    `vitest-${name}`,
    process.execPath,
    [
      bin(join(root, pkg.dir), 'vitest'),
      'run',
      ...tests,
      ...(config ? ['--config', config] : []),
      '--reporter=dot',
      '--reporter=json',
      `--outputFile.json=${json}`,
    ],
    { cwd: join(root, pkg.dir) },
  );
  section(`${name}: ${label ?? tests.join(' ')}`, result, vitestFailures(json, pkg.dir, result));
}

/** Playwright in `app` on `specs` (its whole suite when empty). */
async function e2e(app, specs, { grep } = {}) {
  const name = `e2e-${short(app)}`;
  const json = join(out, `${name}.json`);
  const result = await run(
    name,
    process.execPath,
    [
      bin(join(root, app), '@playwright/test', 'playwright'),
      'test',
      ...specs.map((file) => file.slice(`${app}/`.length)),
      ...(grep ? ['--grep', grep] : []),
      '--reporter=line,json',
    ],
    { cwd: join(root, app), env: { PLAYWRIGHT_JSON_OUTPUT_NAME: json } },
  );
  const label =
    specs.length === 0
      ? `e2e ${app}: the whole suite`
      : `e2e ${app}: ${specs.map((file) => file.slice(`${app}/e2e/`.length)).join(', ')}${grep ? ` (only "${grep}")` : ''}`;
  section(label, result, playwrightFailures(json, app));
}

/** `pnpm db:generate` must find nothing to write (CI checks the same). */
async function migrationDrift() {
  const before = git('status', '--porcelain', '--', 'packages/db/migrations');
  const result = await run(
    'migrations',
    process.execPath,
    [bin(join(root, 'packages/db'), 'drizzle-kit'), 'generate'],
    { cwd: join(root, 'packages/db') },
  );
  const after = git('status', '--porcelain', '--', 'packages/db/migrations');
  const drift = result.code === 0 && before !== after;
  if (result.code !== 0 || drift) failed = true;
  report.push(
    result.code !== 0
      ? `migration drift: FAIL, db:generate failed (${result.log})`
      : drift
        ? 'migration drift: FAIL, db:generate wrote a migration: review it and commit it with the schema change'
        : 'migration drift: none, the migrations match the schema',
  );
}

/** The OpenAPI guard needs oasdiff; without it the step says so and CI runs it. */
async function openApiGuard() {
  const oasdiff = process.env.OASDIFF || 'oasdiff';
  const found = spawnSync(oasdiff, ['--version'], { windowsHide: true });
  if (found.error || found.status !== 0) {
    report.push(
      'openapi guard: skipped, oasdiff is not installed (scripts/install-oasdiff.sh; CI runs it)',
    );
    return;
  }
  const result = await run('check-openapi', process.execPath, [
    'scripts/openapi-guard.mjs',
    '--base',
    base,
  ]);
  section('openapi guard', result, result.code === 0 ? [] : pick(read(result.log), /\S/, 12));
}

function finish() {
  const status = failed ? 'FAIL' : 'pass';
  const lines = [
    `pnpm verify: ${status} in ${seconds(Date.now() - started)}`,
    ...report,
    `Logs: .verify/ (${readdirSync(out).length} files)`,
  ];
  const rerun = [...new Set(report.flatMap((line) => line.match(RERUN_FILE) ?? []))];
  if (failed && rerun.length > 0) {
    lines.push(`Rerun only what failed: pnpm verify ${rerun.join(' ')}`);
  }
  const text = `${lines.join('\n')}\n`;
  writeFileSync(join(out, 'summary.md'), text);
  process.stdout.write(text);
  process.exitCode = failed ? 1 : 0;
}

// ---- Steps and their output ------------------------------------------------------------------

/** Runs a command with its whole output in .verify/<name>.log. */
function run(name, command, args, { cwd = root, env = {} } = {}) {
  const log = join(out, `${name}.log`);
  const file = createWriteStream(log);
  file.write(`$ ${[command, ...args].join(' ')}\n(in ${cwd})\n\n`);
  const begun = Date.now();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(file, { end: false });
  child.stderr.pipe(file, { end: false });
  return new Promise((done) => {
    child.on('error', (error) => file.write(`\n${String(error)}\n`));
    child.on('close', (code) => {
      file.end(() =>
        done({
          code: code ?? 1,
          ms: Date.now() - begun,
          log: relative(root, log).replaceAll('\\', '/'),
        }),
      );
    });
  });
}

function section(label, result, details) {
  if (result.code !== 0) failed = true;
  report.push(`${label}: ${result.code === 0 ? 'pass' : 'FAIL'} (${seconds(result.ms)})`);
  for (const line of details) report.push(`  ${line}`);
}

/** Turborepo's run summary: each task's cache status, exit code, time and log. */
function turboTasks(log) {
  const found = log.match(/^\s*Summary:\s+(.+\.json)\s*$/m)?.[1];
  const path = found && resolve(root, found);
  if (!path || !existsSync(path)) return [];
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  rmSync(path, { force: true });
  return summary.tasks.map((task) => {
    const logFile = join(root, task.logFile ?? '');
    return {
      id: task.taskId,
      status: task.cache?.status,
      exitCode: task.execution?.exitCode ?? 0,
      ms: (task.execution?.endTime ?? 0) - (task.execution?.startTime ?? 0),
      logFile: relative(root, logFile).replaceAll('\\', '/'),
      get log() {
        return existsSync(logFile) ? stripAnsi(readFileSync(logFile, 'utf8')) : '';
      },
    };
  });
}

/** The scenario book's counts: Approved cases run, Proposed ones skipped (never counted). */
function scenarioCount(log) {
  const line = log.match(/^.*\bTests\s+(.+)$/m)?.[1];
  return line ? line.replace(/\s+/g, ' ').trim() : 'no summary in its log';
}

function vitestFailures(json, pkgDir, result) {
  if (!existsSync(json)) return result.code === 0 ? [] : pick(read(result.log), TASK_LINES, 14);
  const lines = [];
  const {
    testResults = [],
    numTotalTests = 0,
    numFailedTests = 0,
    numPendingTests = 0,
  } = JSON.parse(readFileSync(json, 'utf8'));
  const ran = numTotalTests - numPendingTests;
  lines.push(
    `${ran - numFailedTests}/${ran} tests passed` +
      (numPendingTests > 0 ? `, ${numPendingTests} skipped` : ''),
  );
  for (const file of testResults) {
    const path = `${pkgDir}/${relative(join(root, pkgDir), file.name).replaceAll('\\', '/')}`;
    const failing = file.assertionResults.filter((test) => test.status === 'failed');
    if (failing.length === 0 && file.status !== 'failed') continue;
    lines.push(`FAIL ${path}`);
    if (failing.length === 0) lines.push(`  ${firstLine(stripAnsi(file.message ?? ''))}`);
    for (const test of failing.slice(0, 5)) {
      lines.push(`  ${test.fullName}: ${firstLine(stripAnsi(test.failureMessages?.[0] ?? ''))}`);
    }
    if (failing.length > 5) lines.push(`  …and ${failing.length - 5} more in this file`);
  }
  return lines;
}

function playwrightFailures(json, app) {
  if (!existsSync(json)) return [];
  const results = JSON.parse(readFileSync(json, 'utf8'));
  const lines = [];
  const stats = results.stats ?? {};
  lines.push(
    `${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.flaky ?? 0} flaky`,
  );
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (!last || last.status === 'passed' || last.status === 'skipped') continue;
        lines.push(
          `FAIL ${app}/e2e/${spec.file ?? file}:${spec.line}: ${spec.title} (${last.status}): ${firstLine(stripAnsi(last.error?.message ?? ''))}`,
        );
      }
    }
    for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
  };
  for (const suite of results.suites ?? []) walk(suite, suite.file);
  return lines.slice(0, 16);
}

/** Lines that say what went wrong, without repeats. */
function pick(text, pattern, limit) {
  const seen = new Set();
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\w@/-]+:[\w:-]+: /, '').trim();
    if (!pattern.test(line) || seen.has(line) || line.startsWith('$ ') || line.startsWith('(in '))
      continue;
    seen.add(line);
    lines.push(line.length > 220 ? `${line.slice(0, 217)}…` : line);
    if (lines.length === limit) break;
  }
  return lines;
}

// ---- Git, packages, tools --------------------------------------------------------------------

function parseArgs(args) {
  const result = { files: [], e2eAll: false, allowDev: false, base: undefined, grep: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--e2e-all') result.e2eAll = true;
    else if (arg === '--allow-dev') result.allowDev = true;
    else if (arg === '--base') result.base = args[++index];
    else if (arg === '--grep' || arg === '-g') result.grep = args[++index];
    else if (arg.startsWith('-')) refuse(`Unknown option ${arg} (see scripts/verify.mjs).`);
    else result.files.push(arg);
  }
  return result;
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) refuse(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function defaultBase() {
  const remote = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], {
    cwd: root,
    windowsHide: true,
  });
  return git('merge-base', 'HEAD', remote.status === 0 ? 'origin/main' : 'main');
}

/** Files that differ from `base` in the working tree, committed or not, and new untracked ones. */
function changedFiles(from) {
  const listed = [
    ...git('diff', '--name-only', from).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ];
  return [...new Set(listed.filter(Boolean))];
}

function workspacePackages() {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, 'package.json')),
      )
      .map((entry) => ({
        dir: `${group}/${entry.name}`,
        name: JSON.parse(readFileSync(join(root, group, entry.name, 'package.json'), 'utf8')).name,
      })),
  );
}

/** The apps that have a Playwright suite. */
function e2eApps() {
  return packages
    .map((pkg) => pkg.dir)
    .filter(
      (dir) => dir.startsWith('apps/') && existsSync(join(root, dir, 'playwright.config.ts')),
    );
}

function appOf(file) {
  return file.match(E2E_SPEC)[1];
}

function packageName(dir) {
  return packages.find((pkg) => pkg.dir === dir)?.name ?? dir;
}

function short(dir) {
  return dir.split('/').at(-1);
}

/** The JavaScript entry of a dependency's command, run with Node (no shell, no quoting). */
function bin(fromDir, pkg, name = pkg.split('/').at(-1)) {
  for (const dir of [fromDir, root]) {
    const manifest = join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    if (!existsSync(manifest)) continue;
    const { bin: bins } = JSON.parse(readFileSync(manifest, 'utf8'));
    const entry = typeof bins === 'string' ? bins : bins?.[name];
    if (entry) return join(dirname(manifest), entry);
  }
  refuse(`${pkg} is not installed in ${relative(root, fromDir) || '.'}: run pnpm install.`);
}

function listening(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/** One verify at a time on this machine: two runs would share the CPU and the database server. */
function takeLock() {
  const mine = JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: root });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockFile, mine, { flag: 'wx' });
      process.on('exit', () => {
        try {
          if (readFileSync(lockFile, 'utf8') === mine) rmSync(lockFile, { force: true });
        } catch {
          // Already gone.
        }
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = lockHolder();
      if (held) {
        refuse(
          `pnpm verify is already running (pid ${held.pid} since ${held.since}, in ${held.cwd}). ` +
            'Wait for its summary instead of starting another run. A lock left by a killed run ' +
            `expires after 30 minutes; ${lockFile} is the file.`,
        );
      }
      rmSync(lockFile, { force: true });
    }
  }
}

/**
 * Who holds the lock: nobody once its process is gone or after LOCK_MAX_AGE_MS, since a killed
 * run leaves the file behind and Windows soon gives its pid to another process.
 */
function lockHolder() {
  try {
    const held = JSON.parse(readFileSync(lockFile, 'utf8'));
    return alive(held.pid) && Date.now() - Date.parse(held.since) < LOCK_MAX_AGE_MS ? held : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function refuse(message) {
  console.error(message);
  process.exit(3);
}

function read(log) {
  return stripAnsi(readFileSync(join(root, log), 'utf8'));
}

function stripAnsi(text) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function firstLine(text) {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  return line.trim().slice(0, 200);
}

function seconds(ms) {
  const total = Math.round(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}
