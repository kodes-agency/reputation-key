// Runtime environment contract tripwire.
//
// WHY THIS EXISTS. On 2026-08-31 a merge landed commit 739ccbc9, which split
// every sidecar's single port into a plain health port and a private mTLS
// port: `PORT` changed from '8443' to a required literal '8080',
// `INTERNAL_MTLS_PORT` became required, and the Google sidecars gained a
// boot-time allowlist that rejects any unlisted variable. The repository
// stayed self-consistent throughout — `.railway/railway.ts` declared the new
// values and 198 tests agreed — so every gate passed and the PR merged clean.
// The LIVE environment still carried the old values, so two services
// crash-looped on `bind address is invalid` and Railway's health probe never
// went green.
//
// Nothing in CI said "this PR changes what the running environment must
// provide". That is the single missing signal, and it is what this gate adds.
//
// WHAT IT IS AND IS NOT. This is a HUMAN PROMPT, not a proof. It cannot see
// the live environment, so it cannot know whether Railway already satisfies
// the new contract. It fails when a file that defines the contract changes,
// so a person confirms the deployed environment before the change ships. A
// drift check against live Railway would be stronger and needs an API token;
// this one needs nothing and still catches the class of failure above.
//
// TO RESOLVE A FAILURE: update the deployed environment to satisfy the new
// contract, then refresh the snapshot in the same commit. Refreshing it alone
// silences the alarm without fixing anything, which is the one thing this
// gate exists to make awkward.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SNAPSHOT_PATH = resolve(
  ROOT,
  'scripts/ci/runtime-environment-contract.snapshot.json',
)

/**
 * Every file whose contents decide what the RUNNING environment must supply.
 * A change to any of them can break a deployed service without breaking a
 * single test, because the tests check the repository against itself.
 */
const CONTRACT_FILES: readonly string[] = Object.freeze([
  'services/ai-egress-gateway/environment.ts',
  'services/ai-execution-admission/environment.ts',
  'services/google-egress-gateway/environment.ts',
  'services/google-execution-admission/environment.ts',
  'services/sidecar-runtime-ports.ts',
  'services/internal-mtls.ts',
  'src/shared/config/env.ts',
  'src/shared/config/release-identity.ts',
  '.railway/railway.ts',
  // Added 2026-08-31 after it caused exactly the failure this gate exists to
  // catch, and was not covered. It decides — from RAILWAY_PROJECT_NAME,
  // RAILWAY_ENVIRONMENT_NAME, PROCESSING_CELL and
  // REPKEY_RAILWAY_DEPLOYMENT_PROFILE — whether a deploy is allowed to run its
  // migration at all. A change here can pass every repository-only gate and
  // then refuse every deployment, which is what happened to `web`.
  'src/shared/db/deploy-migration-runtime.ts',
  'src/shared/release/railway-deployment-profile.ts',
])

export type ContractSnapshot = Readonly<{
  version: 1
  /** Repository-relative path to lowercase sha256 of the file's bytes. */
  files: Readonly<Record<string, string>>
}>

export function digestOf(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex')
}

export function buildSnapshot(
  read: (path: string) => string,
  files: readonly string[] = CONTRACT_FILES,
): ContractSnapshot {
  const entries: Record<string, string> = {}
  for (const file of [...files].sort()) {
    entries[file] = digestOf(read(file))
  }
  return Object.freeze({ version: 1, files: Object.freeze(entries) })
}

export type ContractDrift = Readonly<{
  path: string
  reason: 'changed' | 'added' | 'removed'
}>

export function compareSnapshots(
  recorded: ContractSnapshot,
  current: ContractSnapshot,
): readonly ContractDrift[] {
  const drift: ContractDrift[] = []
  const paths = [
    ...new Set([...Object.keys(recorded.files), ...Object.keys(current.files)]),
  ]
  for (const path of paths.sort()) {
    const before = recorded.files[path]
    const after = current.files[path]
    if (before === after) continue
    if (before === undefined) drift.push({ path, reason: 'added' })
    else if (after === undefined) drift.push({ path, reason: 'removed' })
    else drift.push({ path, reason: 'changed' })
  }
  return Object.freeze(drift)
}

function readContractFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function main(argv: readonly string[]): number {
  const current = buildSnapshot(readContractFile)

  if (argv.includes('--update')) {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    process.stdout.write(
      `[runtime-environment-contract] snapshot refreshed for ${String(Object.keys(current.files).length)} files\n`,
    )
    return 0
  }

  let recorded: ContractSnapshot
  try {
    recorded = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ContractSnapshot
  } catch {
    process.stderr.write(
      `[runtime-environment-contract] no snapshot at ${SNAPSHOT_PATH}. Create it with:\n` +
        '  pnpm check:runtime-environment-contract -- --update\n',
    )
    return 1
  }

  const drift = compareSnapshots(recorded, current)
  if (drift.length === 0) {
    process.stdout.write(
      `[runtime-environment-contract] OK — ${String(Object.keys(current.files).length)} contract files unchanged\n`,
    )
    return 0
  }

  process.stderr.write(
    '[runtime-environment-contract] The runtime environment contract changed:\n' +
      `${drift.map((entry) => `  ${entry.reason.padEnd(7)} ${entry.path}`).join('\n')}\n\n` +
      'These files decide what a DEPLOYED service must supply at boot. The rest of\n' +
      'CI only proves the repository agrees with itself, so a change here can pass\n' +
      'every other gate and still crash-loop production — that is exactly how the\n' +
      'sidecar port split (739ccbc9) took two services down.\n\n' +
      'Before merging:\n' +
      '  1. Work out what the deployed environment must now provide (new required\n' +
      '     variables, changed literal values, a stricter allowlist).\n' +
      '  2. Update every deployed environment to satisfy it.\n' +
      '  3. Refresh the snapshot IN THIS COMMIT:\n' +
      '       pnpm check:runtime-environment-contract -- --update\n',
  )
  return 1
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  process.exit(main(process.argv.slice(2)))
}
