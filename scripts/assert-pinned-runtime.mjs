#!/usr/bin/env node
// `preinstall` guard: refuse to install on anything but the pinned runtime.
//
// This is the enforcement `engine-strict` looked like it should provide. It does
// not, usefully: in pnpm that flag also hard-enforces every package's os/cpu,
// so the darwin/arm64 rolldown binding in the lockfile turns every linux CI
// install into ERR_PNPM_UNSUPPORTED_PLATFORM (see .npmrc). This checks the one
// thing that matters and nothing else.
//
// Why it matters at install time rather than at first failure: on a non-pinned
// Node major, scripts/local-stack/stack.ts fails ENOBUFS mid-boot with the
// containers already up, and Node 26 ships ICU 78.3 rather than 78.2, which
// silently SKIPS the fenced AI-language suites (~150 assertions) instead of
// failing them.
//
// .nvmrc is the single source of truth; src/shared/testing/pinned-runtime.ts
// carries the same values for TS callers and its test asserts these two agree.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED_ICU = '78.2'
const EXPECTED_UNICODE = '17.0'

const expected = {
  node: readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim(),
  icu: EXPECTED_ICU,
  unicode: EXPECTED_UNICODE,
}

const drifted = Object.entries(expected).filter(
  ([key, value]) => process.versions[key] !== value,
)

if (drifted.length > 0) {
  const detail = drifted
    .map(
      ([key, value]) => `  ${key}: expected ${value}, running ${process.versions[key]}`,
    )
    .join('\n')
  process.stderr.write(
    `\nThis repo runs on a pinned Node runtime (.nvmrc):\n${detail}\n\n` +
      'Both `fnm use` and `nvm use` read .nvmrc — run one in the repo root, then\n' +
      'retry. Installing on another Node major leaves the local stack failing\n' +
      'ENOBUFS mid-boot and the ICU-fenced suites silently skipped.\n\n',
  )
  process.exit(1)
}
