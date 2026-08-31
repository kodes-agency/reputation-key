import { describe, expect, it } from 'vitest'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '../../src/shared/domain/data-cell-catalogue'
import {
  REQUIRED_FREEZE_DRIFT_GATES,
  parseCandidateFreezeRecord,
} from '../../src/shared/release/candidate-freeze-record'
import {
  runFreezeReleaseCandidateCli,
  type FreezeDependencies,
} from './freeze-release-candidate'

const RELEASE_SHA = 'a'.repeat(40)
const ARGS = [
  `--release-sha=${RELEASE_SHA}`,
  '--operator=release-operator',
  '--change-record=CHG-REL-01-001',
  '--legal-revision-set=legal/revision-set.json',
]

const FILES: Readonly<Record<string, string>> = {
  'pnpm-lock.yaml': 'lockfile\n',
  'package.json': '{"packageManager":"pnpm@10.0.0"}\n',
  'src/routeTree.gen.ts': 'route tree\n',
  'legal/revision-set.json': 'legal revision set\n',
  'drizzle/meta/_journal.json': JSON.stringify({
    entries: [{ tag: '0167_prior' }, { tag: '0168_identity_receipts' }],
  }),
  'node_modules/@playwright/test/package.json': '{"version":"1.55.0"}',
  'node_modules/playwright-core/browsers.json': JSON.stringify({
    browsers: [
      { name: 'chromium', revision: '1187' },
      { name: 'firefox', revision: '1489' },
      { name: 'webkit', revision: '2191' },
    ],
  }),
}

type Harness = Readonly<{
  deps: FreezeDependencies
  written: Map<string, string>
  errors: string[]
  logs: string[]
}>

function harness(
  overrides: Partial<FreezeDependencies> = {},
  existingPaths: readonly string[] = [],
): Harness {
  const written = new Map<string, string>()
  const errors: string[] = []
  const logs: string[] = []
  const deps: FreezeDependencies = {
    run: (command, args) => {
      if (command === 'git' && args[0] === 'status') return { status: 0, stdout: '' }
      if (command === 'git' && args[0] === 'merge-base') return { status: 0, stdout: '' }
      return { status: 0, stdout: 'Version 1.55.0\n' }
    },
    readFile: (path) => {
      const content = FILES[path]
      if (content === undefined) throw new Error(`no file at ${path}`)
      return Buffer.from(content)
    },
    writeFileExclusive: (path, content) => {
      if (existingPaths.includes(path) || written.has(path)) {
        throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
          code: 'EEXIST',
        })
      }
      written.set(path, content)
    },
    releaseControllerSha256: () => 'c'.repeat(64),
    iacSha256: () => 'd'.repeat(64),
    now: () => new Date('2026-08-28T08:00:00.000Z'),
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    ...overrides,
  }
  return { deps, written, errors, logs }
}

describe('release:freeze-candidate', () => {
  it('writes one canonical freeze record pinning the whole candidate', () => {
    const { deps, written, logs } = harness()

    expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(0)
    expect(written.size).toBe(1)
    const [path, content] = [...written.entries()][0] ?? ['', '']
    expect(path).toBe(`docs/release-evidence/beta/freeze/${RELEASE_SHA}.json`)
    const parsed = parseCandidateFreezeRecord(content)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.evidence.cells).toEqual(['us'])
      expect(parsed.evidence.migrations.migrationHead).toBe('0168_identity_receipts')
      expect(parsed.evidence.policy.capabilityPolicyVersion).toBe(
        CAPABILITY_POLICY_VERSION,
      )
      expect(parsed.evidence.policy.dataCellCataloguePolicyVersion).toBe(
        DATA_CELL_CATALOGUE_POLICY_VERSION,
      )
      expect(parsed.evidence.browsers.installed).toHaveLength(3)
    }
    expect(logs.join('\n')).toContain('froze')
  })

  it('exits non-zero on a dirty worktree and writes nothing', () => {
    const { deps, written, errors } = harness({
      run: (command, args) =>
        command === 'git' && args[0] === 'status'
          ? { status: 0, stdout: ' M src/shared/release/gate-f-evidence.ts\n' }
          : { status: 0, stdout: '' },
    })

    expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(1)
    expect(written.size).toBe(0)
    expect(errors.join('\n')).toContain('worktree is dirty')
  })

  it('exits non-zero when the SHA is not an ancestor of origin/main', () => {
    const { deps, written, errors } = harness({
      run: (command, args) =>
        command === 'git' && args[0] === 'merge-base'
          ? { status: 1, stdout: '' }
          : { status: 0, stdout: '' },
    })

    expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(1)
    expect(written.size).toBe(0)
    expect(errors.join('\n')).toContain('is not merged into origin/main')
  })

  it.each(REQUIRED_FREEZE_DRIFT_GATES)(
    'refuses to freeze when %s reports drift',
    (gate) => {
      const { deps, written, errors } = harness({
        run: (command, args) =>
          command === 'pnpm' && args[0] === gate
            ? { status: 1, stdout: '' }
            : { status: 0, stdout: '' },
      })

      expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(1)
      expect(written.size).toBe(0)
      expect(errors.join('\n')).toContain(`drift gate ${gate} reports drift`)
    },
  )

  it('exits non-zero when the freeze file already exists', () => {
    const { deps, errors } = harness({}, [
      `docs/release-evidence/beta/freeze/${RELEASE_SHA}.json`,
    ])

    expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(1)
    expect(errors.join('\n')).toContain('EEXIST')
  })

  it('fails when the release-controller source changed during the freeze', () => {
    let call = 0
    const { deps, errors } = harness({
      releaseControllerSha256: () => {
        call += 1
        return call === 1 ? 'c'.repeat(64) : 'e'.repeat(64)
      },
    })

    expect(runFreezeReleaseCandidateCli(ARGS, deps)).toBe(1)
    expect(errors.join('\n')).toContain('changed during the freeze')
  })

  it('refuses an invalid or absent release SHA', () => {
    const { deps, errors } = harness()

    expect(runFreezeReleaseCandidateCli(['--release-sha=nope'], deps)).toBe(2)
    expect(runFreezeReleaseCandidateCli([], deps)).toBe(2)
    expect(errors.join('\n')).toContain('Usage:')
  })
})
