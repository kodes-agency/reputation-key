// REL-01-T9 — freeze an immutable release candidate.
//
// Usage:
//   pnpm release:freeze-candidate -- --release-sha=<40 hex> --operator=<id> \
//     --change-record=<id> --legal-revision-set=<path> [--output=<path>]
//
// The command is READ-ONLY except for the single freeze artifact it writes
// with flag 'wx'. It refuses to emit unless all of the following hold:
//
//   * the worktree is clean — a freeze taken over uncommitted edits pins a
//     SHA that describes different code than the operator is looking at;
//   * the SHA is merged into origin/main — a candidate on an unmerged branch
//     cannot be the thing CI attested;
//   * the generated-artifact drift gates report clean, so the committed
//     fixtures actually describe the frozen code;
//   * the freeze file does not already exist. Re-freezing a candidate is how
//     "the candidate" silently becomes a moving target.
//
// After writing, the release-controller digest is recomputed. If a source file
// under RELEASE_AUTHORITY_SOURCE_PATHS changed while the command was running,
// the freeze it just wrote describes a tree that no longer exists, so the
// command fails and removes nothing — the operator resolves it explicitly.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANDIDATE_FREEZE_RECORD_VERSION,
  REQUIRED_FREEZE_DRIFT_GATES,
  canonicalCandidateFreezeRecord,
  candidateFreezeRecordPath,
  parseCandidateFreezeRecord,
  type CandidateFreezeRecord,
} from '../../src/shared/release/candidate-freeze-record'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '../../src/shared/domain/data-cell-catalogue'
import { railwayIacSourceDigest } from './iac-digest'
import { releaseControllerSourceDigest } from './release-authority-digest'

const RELEASE_SHA = /^[0-9a-f]{40}$/u

export type FreezeCommandRunner = (
  command: string,
  args: readonly string[],
) => Readonly<{ status: number; stdout: string }>

export type FreezeDependencies = Readonly<{
  run: FreezeCommandRunner
  readFile: (path: string) => Uint8Array
  writeFileExclusive: (path: string, content: string) => void
  releaseControllerSha256: () => string
  iacSha256: () => string
  now: () => Date
  log: (line: string) => void
  error: (line: string) => void
}>

function realRunner(command: string, args: readonly string[]) {
  try {
    const stdout = execFileSync(command, [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    return { status: failure.status ?? 1, stdout: failure.stdout ?? '' }
  }
}

export function defaultFreezeDependencies(): FreezeDependencies {
  return {
    run: realRunner,
    readFile: (path) => readFileSync(resolve(process.cwd(), path)),
    writeFileExclusive: (path, content) => {
      writeFileSync(resolve(process.cwd(), path), content, { flag: 'wx' })
    },
    releaseControllerSha256: () => releaseControllerSourceDigest(),
    iacSha256: () => railwayIacSourceDigest(),
    now: () => new Date(),
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  }
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const arg = args.find((value) => value.startsWith(`${flag}=`))
  return arg?.slice(flag.length + 1)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type JournalEntry = Readonly<{ tag: string }>

function migrationHead(
  deps: FreezeDependencies,
): Readonly<{ headTag: string; entryCount: number; journalSha256: string }> {
  const bytes = deps.readFile('drizzle/meta/_journal.json')
  const journal = JSON.parse(Buffer.from(bytes).toString('utf8')) as Readonly<{
    entries: readonly JournalEntry[]
  }>
  const head = journal.entries.at(-1)
  if (!head) throw new Error('drizzle/meta/_journal.json has no entries')
  return {
    headTag: head.tag,
    entryCount: journal.entries.length,
    journalSha256: sha256(bytes),
  }
}

function playwrightVersion(deps: FreezeDependencies): string {
  const bytes = deps.readFile('node_modules/@playwright/test/package.json')
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Readonly<{
    version: string
  }>
  return parsed.version
}

function browserVersions(
  deps: FreezeDependencies,
): readonly Readonly<{ name: 'chromium' | 'firefox' | 'webkit'; version: string }>[] {
  const result = deps.run('pnpm', ['exec', 'playwright', '--version'])
  if (result.status !== 0) {
    throw new Error('could not read the installed Playwright browser versions')
  }
  // `playwright --version` prints `Version <x.y.z>`; the browser build is read
  // from the installed browsers.json so the freeze pins what will actually run.
  const browsers = JSON.parse(
    Buffer.from(deps.readFile('node_modules/playwright-core/browsers.json')).toString(
      'utf8',
    ),
  ) as Readonly<{ browsers: readonly Readonly<{ name: string; revision: string }>[] }>
  const wanted = ['chromium', 'firefox', 'webkit'] as const
  return wanted.flatMap((name) => {
    const entry = browsers.browsers.find((browser) => browser.name === name)
    return entry ? [{ name, version: entry.revision }] : []
  })
}

function preflightFailures(
  deps: FreezeDependencies,
  releaseSha: string,
): readonly string[] {
  const failures: string[] = []

  const status = deps.run('git', ['status', '--porcelain'])
  if (status.status !== 0) failures.push('could not read the git worktree status')
  else if (status.stdout.trim() !== '') {
    failures.push('the worktree is dirty; a freeze must describe committed code exactly')
  }

  const merged = deps.run('git', [
    'merge-base',
    '--is-ancestor',
    releaseSha,
    'origin/main',
  ])
  if (merged.status !== 0) {
    failures.push(`${releaseSha} is not merged into origin/main`)
  }

  for (const gate of REQUIRED_FREEZE_DRIFT_GATES) {
    const result = deps.run('pnpm', [gate])
    if (result.status !== 0) {
      failures.push(`generated-artifact drift gate ${gate} reports drift`)
    }
  }

  return failures
}

export function runFreezeReleaseCandidateCli(
  args: readonly string[],
  deps: FreezeDependencies = defaultFreezeDependencies(),
): number {
  const releaseSha = argValue(args, '--release-sha')
  const operator = argValue(args, '--operator')
  const changeRecord = argValue(args, '--change-record')
  const legalRevisionSetPath = argValue(args, '--legal-revision-set')
  if (
    releaseSha === undefined ||
    !RELEASE_SHA.test(releaseSha) ||
    !operator ||
    !changeRecord ||
    !legalRevisionSetPath
  ) {
    deps.error(
      'Usage: pnpm release:freeze-candidate -- --release-sha=<40 hex> --operator=<id> --change-record=<id> --legal-revision-set=<path> [--output=<path>]',
    )
    return 2
  }
  const outputPath = argValue(args, '--output') ?? candidateFreezeRecordPath(releaseSha)

  const failures = preflightFailures(deps, releaseSha)
  if (failures.length > 0) {
    for (const failure of failures) deps.error(`FAIL ${failure}`)
    return 1
  }

  let record: CandidateFreezeRecord
  try {
    const migrations = migrationHead(deps)
    record = {
      version: CANDIDATE_FREEZE_RECORD_VERSION,
      evidenceKind: 'candidate-freeze',
      releaseSha,
      frozenAt: deps.now().toISOString(),
      frozenBy: operator,
      changeRecord,
      cells: ['us'],
      dependencies: {
        lockfilePath: 'pnpm-lock.yaml',
        lockfileSha256: sha256(deps.readFile('pnpm-lock.yaml')),
        nodeVersion: process.versions.node,
        packageManager:
          (
            JSON.parse(
              Buffer.from(deps.readFile('package.json')).toString('utf8'),
            ) as Readonly<{ packageManager?: string }>
          ).packageManager ?? 'pnpm',
      },
      migrations: {
        journalPath: 'drizzle/meta/_journal.json',
        journalSha256: migrations.journalSha256,
        migrationHead: migrations.headTag,
        entryCount: migrations.entryCount,
      },
      generatedArtifacts: {
        routeTreePath: 'src/routeTree.gen.ts',
        routeTreeSha256: sha256(deps.readFile('src/routeTree.gen.ts')),
        driftGates: REQUIRED_FREEZE_DRIFT_GATES.map((script) => ({
          script,
          outcome: 'clean' as const,
        })),
      },
      authority: {
        releaseControllerSha256: deps.releaseControllerSha256(),
        iacSha256: deps.iacSha256(),
      },
      policy: {
        capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
        dataCellCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      },
      browsers: {
        playwrightPackageVersion: playwrightVersion(deps),
        installed: [...browserVersions(deps)],
      },
      legalRevisionSetSha256: sha256(deps.readFile(legalRevisionSetPath)),
    }
  } catch (error) {
    deps.error(
      `FAIL could not assemble the freeze record: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  const content = canonicalCandidateFreezeRecord(record)
  const parsed = parseCandidateFreezeRecord(content)
  if (!parsed.ok) {
    for (const failure of parsed.errors) deps.error(`FAIL ${failure}`)
    return 1
  }

  try {
    deps.writeFileExclusive(outputPath, content)
  } catch (error) {
    deps.error(
      `FAIL could not write ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  // A freeze that raced a source edit describes a tree that no longer exists.
  const after = deps.releaseControllerSha256()
  if (after !== record.authority.releaseControllerSha256) {
    deps.error(
      `FAIL release-controller source changed during the freeze (${record.authority.releaseControllerSha256} -> ${after}); ${outputPath} does not describe the current tree`,
    )
    return 1
  }

  deps.log(`froze ${releaseSha} -> ${outputPath} (${parsed.digest})`)
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runFreezeReleaseCandidateCli(process.argv.slice(2))
}
