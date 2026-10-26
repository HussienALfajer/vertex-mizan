#!/usr/bin/env bash
# Installs the pinned oasdiff release for `pnpm check:openapi` (scripts/openapi-guard.mjs) on a
# Linux x86-64 runner: downloads it, checks its SHA-256 against the value pinned here (from the
# release's checksums.txt), and puts it on the PATH of the next GitHub Actions steps. Updating
# oasdiff means changing both values below in one reviewed commit.
set -euo pipefail

version=1.34.1
sha256=75775f65b0adebd26a8e013af51a799342dfdc6262d89efa9e3b7bdf89657d90

dir="${RUNNER_TEMP:-$(mktemp -d)}/oasdiff"
mkdir -p "$dir"
archive="$dir/oasdiff.tar.gz"
curl -fsSL --retry 3 -o "$archive" \
  "https://github.com/oasdiff/oasdiff/releases/download/v${version}/oasdiff_${version}_linux_amd64.tar.gz"
echo "$sha256  $archive" | sha256sum --check --strict
tar -xzf "$archive" -C "$dir" oasdiff
"$dir/oasdiff" --version
if [ -n "${GITHUB_PATH:-}" ]; then echo "$dir" >> "$GITHUB_PATH"; fi
