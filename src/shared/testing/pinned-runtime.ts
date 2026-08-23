// The pinned local runtime, and the fail-fast assert for tooling that depends
// on it.
//
// `.nvmrc` is the single source of truth for the Node version: every ci.yml /
// simulation.yml job resolves it through `actions/setup-node`'s
// `node-version-file`, `engines.node` names the same value, and `.npmrc` sets
// engine-strict so pnpm refuses to install on anything else.
//
// Why the local orchestrators assert it rather than trusting the floor: on Node
// 26 the local-stack controller's `spawnSync('docker', …)` calls fail `ENOBUFS`
// (with maxBuffer already at 64 MiB) AFTER the containers are up, and the
// diagnostics collector that would explain it fails the same way — so a wrong
// runtime presents as a broken stack, and `e2e:stack:down` cannot clean up
// either. One check at entry turns an hour of container archaeology into a
// one-line message.
//
// ICU and Unicode are properties of the Node build, so pinning the version
// pins all three; they are asserted explicitly because the fenced AI-language
// suites and the generated review-language group tables are only valid on this
// exact ICU (see scripts/check-test-quality.mjs `PINNED_RUNTIME`, which
// src/shared/testing/pinned-runtime.test.ts holds to the same values).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Shipped with node 22.23.2; the review-language group tables are generated from it. */
export const PINNED_ICU_VERSION = '78.2'
export const PINNED_UNICODE_VERSION = '17.0'

/** The Node version in `.nvmrc` — the value CI installs and pnpm enforces. */
export function pinnedNodeVersion(repoRoot: string = process.cwd()): string {
  return readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8').trim()
}

/**
 * The drift message for the running process, or null when it matches the pin.
 * Returned rather than thrown so callers can decide (a test asserts the text,
 * the orchestrators exit on it).
 */
export function pinnedRuntimeDrift(repoRoot?: string): string | null {
  const expected = {
    node: pinnedNodeVersion(repoRoot),
    icu: PINNED_ICU_VERSION,
    unicode: PINNED_UNICODE_VERSION,
  }
  const drifted = Object.entries(expected).filter(
    ([key, value]) => process.versions[key as keyof NodeJS.ProcessVersions] !== value,
  )
  if (drifted.length === 0) return null
  const detail = drifted
    .map(
      ([key, value]) =>
        `  ${key}: expected ${value}, running ${String(process.versions[key as keyof NodeJS.ProcessVersions])}`,
    )
    .join('\n')
  return (
    `this command requires the pinned runtime (.nvmrc):\n${detail}\n` +
    'Use it with `fnm use` or `nvm use` in the repo root (both read .nvmrc), ' +
    'then re-run.\nRunning the local stack on another Node major fails ENOBUFS ' +
    'mid-boot and leaves containers behind.'
  )
}

/** Fail fast before doing any work. */
export function assertPinnedRuntime(repoRoot?: string): void {
  const drift = pinnedRuntimeDrift(repoRoot)
  if (drift) throw new Error(drift)
}
