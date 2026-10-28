// The pinned command-line tools the checks run, installed the same way on the owner's Windows
// machine, a cloud session and CI: oasdiff for the OpenAPI guard (ADR 0006) and gitleaks for the
// secret scan. Each release is downloaded once into .tools/ (git-ignored), checked against the
// SHA-256 pinned here (from the release's checksums file), and unpacked. Updating a tool means
// changing its version and both checksums in one reviewed commit; gitleaks stays on the version
// the CI secret scan pins (GITLEAKS_VERSION in .github/workflows/ci.yml).
//
//   node scripts/tools.mjs install [name...]   install the named tools (all when none is named)
//   node scripts/tools.mjs path <name>          print the tool's path; exit 1 when it is missing
//
// `OASDIFF` or `GITLEAKS` names another binary instead (the guard's tests use it for a missing one).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = join(root, '.tools');

export const TOOLS = {
  oasdiff: {
    version: '1.34.1',
    env: 'OASDIFF',
    url: (file) => `https://github.com/oasdiff/oasdiff/releases/download/v1.34.1/${file}`,
    assets: {
      'linux-x64': {
        file: 'oasdiff_1.34.1_linux_amd64.tar.gz',
        sha256: '75775f65b0adebd26a8e013af51a799342dfdc6262d89efa9e3b7bdf89657d90',
      },
      'win32-x64': {
        file: 'oasdiff_1.34.1_windows_amd64.tar.gz',
        sha256: '15e6f32ece94244534a61ce4fb1d60912e51e67e363a05bb6561d89b28df73bb',
      },
    },
  },
  gitleaks: {
    version: '8.24.3',
    env: 'GITLEAKS',
    url: (file) => `https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/${file}`,
    assets: {
      'linux-x64': {
        file: 'gitleaks_8.24.3_linux_x64.tar.gz',
        sha256: '9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c',
      },
      'win32-x64': {
        file: 'gitleaks_8.24.3_windows_x64.zip',
        sha256: '3f1a35578631dbfe633cc5b49e6c906e55ff14a4bfd7336a10fb27fe33b6dcd2',
      },
    },
  },
};

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
const home = (name) => join(dir, `${name}-${TOOLS[name].version}`);

/** The tool's binary: the one its variable names, else the installed one, else null. */
export function toolPath(name) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool ${name}`);
  if (process.env[tool.env]) return process.env[tool.env];
  const path = join(home(name), exe(name));
  return existsSync(path) ? path : null;
}

/** Installs the tool when it is missing and returns its binary; throws when it cannot. */
export async function installTool(name) {
  const present = toolPath(name);
  if (present) return present;
  const tool = TOOLS[name];
  const asset = tool.assets[`${process.platform}-${process.arch}`];
  if (!asset)
    throw new Error(`${name} has no pinned release for ${process.platform}-${process.arch}`);
  const response = await fetch(tool.url(asset.file));
  if (!response.ok) throw new Error(`downloading ${asset.file} failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) {
    throw new Error(`${asset.file} has SHA-256 ${sha256}, not the pinned ${asset.sha256}`);
  }
  const target = home(name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const archive = join(target, asset.file);
  writeFileSync(archive, bytes);
  // Windows' own bsdtar reads zip and tar.gz; Git Bash's GNU tar, often first on the PATH, reads
  // neither a zip nor a path with a drive letter.
  const tar =
    process.platform === 'win32'
      ? // biome-ignore lint/suspicious/noUndeclaredEnvVars: read by this installer only, never by a Turborepo task.
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const unpacked = spawnSync(tar, ['-xf', archive, '-C', target, exe(name)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  rmSync(archive, { force: true });
  if (unpacked.status !== 0) {
    throw new Error(`unpacking ${asset.file} failed: ${unpacked.stderr || unpacked.error}`);
  }
  return join(target, exe(name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...names] = process.argv.slice(2);
  if (command === 'path' && names.length === 1) {
    const path = toolPath(names[0]);
    if (path) process.stdout.write(`${path}\n`);
    process.exitCode = path ? 0 : 1;
  } else if (command === 'install') {
    for (const name of names.length > 0 ? names : Object.keys(TOOLS)) {
      try {
        process.stdout.write(`${name} ${TOOLS[name].version}: ${await installTool(name)}\n`);
      } catch (error) {
        process.stderr.write(`${name}: ${error.message}\n`);
        process.exitCode = 1;
      }
    }
  } else {
    process.stderr.write('Usage: node scripts/tools.mjs install [name...] | path <name>\n');
    process.exitCode = 2;
  }
}
