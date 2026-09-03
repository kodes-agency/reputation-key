import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disarmPathSwap } from '../../src/shared/testing/descriptor-race.test-harness'
import { armRebindOnFirstCheck } from '../../src/shared/testing/descriptor-rebind.test-harness'
import {
  GATE_F_REQUIRED_APPROVAL_ROLES,
  gateFRequiredGateIdsFor,
} from '../../src/shared/release/gate-f-evidence'
import {
  completeGateFBundle,
  rehearsalCanaryArtifact,
  type CompleteGateFBundleOverrides,
} from '../../src/shared/release/gate-f-complete-evidence.test-fixtures'
import { approvedLegalDocumentsFixture } from '../../src/shared/release/legal-revision-set-evidence.test-fixtures'
import { canonicalLegalRevisionSetEvidence } from '../../src/shared/release/legal-revision-set-evidence'
import {
  legalRevisionSetContextFixture,
  legalRevisionSetFixture,
} from '../../src/shared/release/legal-revision-set-evidence.test-fixtures'
import { completeBundleCandidate } from '../../src/shared/release/gate-f-complete-evidence.test-fixtures'
import { runReleaseValidationCli } from './validate-bundle'

const CLOSED_BETA_GATE_IDS = gateFRequiredGateIdsFor('closed-beta')
const ALL_GATE_IDS = gateFRequiredGateIdsFor('open-beta')

// Lets a test rebind a path the instant the CLI first checks or opens it, which
// is the only way to tell a path-based file-shape guard apart from one that
// guards the open descriptor. Disarmed by default, so every other test in this
// file runs against unmodified `node:fs`.
vi.mock('node:fs', async () => {
  const { withPathSwapRace } =
    await import('../../src/shared/testing/descriptor-race.test-harness')
  return withPathSwapRace(await vi.importActual<typeof import('node:fs')>('node:fs'))
})

const temporaryRoots: string[] = []

afterEach(() => {
  disarmPathSwap()
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

type LaidOutBundle = Readonly<{
  args: readonly string[]
  root: string
}>

/**
 * Materialize a complete Gate F bundle on disk together with the ephemeral
 * public-key role map and the legal documents it was approved over, so the CLI
 * exercises the real reader, containment and verifier paths.
 */
function layOutBundle(overrides: CompleteGateFBundleOverrides = {}): LaidOutBundle {
  const root = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
  temporaryRoots.push(root)
  const evidenceRoot = join(root, 'evidence')
  const legalRoot = join(root, 'legal-root')
  mkdirSync(evidenceRoot, { recursive: true })

  const bundle = completeGateFBundle(overrides)
  for (const [path, bytes] of bundle.files) {
    const target = join(evidenceRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const indexPath = join(evidenceRoot, 'gate-f-index.json')
  writeFileSync(indexPath, bundle.content)

  for (const [path, bytes] of approvedLegalDocumentsFixture().files) {
    const target = join(legalRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }

  const rolesPath = join(root, 'gate-f-approval-roles.json')
  writeFileSync(rolesPath, `${JSON.stringify(bundle.keyRing.roleKeys, null, 2)}\n`)

  return {
    root,
    args: [
      `--gate-f-index=${indexPath}`,
      `--evidence-root=${evidenceRoot}`,
      `--approval-roles=${rolesPath}`,
      `--legal-root=${legalRoot}`,
    ],
  }
}

/**
 * Replace an existing path with a FIFO — a shape the CLI must refuse.
 *
 * This does NOT demonstrate descriptor identity: a path `statSync` refuses a
 * FIFO exactly as an `fstatSync` on the open descriptor does. What it pins is
 * that the refusal still arrives PROMPTLY once the guard runs after an open,
 * because that open is non-blocking and so cannot wait for a writer that never
 * comes. Descriptor identity is covered by the path-rebind tests instead.
 */
function replaceWithFifo(path: string): void {
  rmSync(path)
  const created = spawnSync('mkfifo', [path])
  expect(created.status).toBe(0)
}

function runWithCapturedStderr(args: readonly string[]): Readonly<{
  exitCode: number
  stderr: string
}> {
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    const exitCode = runReleaseValidationCli(args)
    return { exitCode, stderr: stderr.mock.calls.flat().join('\n') }
  } finally {
    stderr.mockRestore()
    stdout.mockRestore()
  }
}

describe('release evidence validation CLI', () => {
  it('requires exactly one evidence format', () => {
    const result = runWithCapturedStderr([
      '--release-id=historical-release',
      `--release-sha=${'a'.repeat(40)}`,
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('choose exactly one')
  })

  it('treats an absent historical evidence file as missing, not as a crash', () => {
    // The release-id reader asks for the bytes and lets a failed open stand for
    // absence, instead of asking whether the path exists and then reading it.
    // An id with no bundle on disk must therefore reach the bundle validator
    // with an empty file set and be reported as incomplete.
    const result = runWithCapturedStderr(['--release-id=no-such-bundle'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing required evidence file: manifest.md')
  })

  it('rejects a Gate F index outside its declared evidence root', () => {
    const root = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
    temporaryRoots.push(root)
    const evidenceRoot = join(root, 'evidence')
    const outsideIndex = join(root, 'outside-index.json')
    mkdirSync(evidenceRoot)
    writeFileSync(outsideIndex, '{}\n')

    const result = runWithCapturedStderr([
      `--gate-f-index=${outsideIndex}`,
      `--evidence-root=${evidenceRoot}`,
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('index resolved outside the evidence root')
  })

  it('refuses a Gate F index that is not a regular file, without blocking on it', () => {
    // The FIFO does not show descriptor identity — a path stat refused one too.
    // What it pins is that moving the shape guard BEHIND an open kept the
    // refusal both prompt and loud: the open is non-blocking, so this test
    // returns instead of hanging on a writer that never arrives, and the guard
    // still refuses rather than validating the zero bytes a non-blocking FIFO
    // read yields. The refusal now travels as a thrown error rather than an
    // inline branch, so the operator-visible line carries the reader prefix —
    // asserted in full below because that wording IS the behaviour change.
    const root = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
    temporaryRoots.push(root)
    const evidenceRoot = join(root, 'evidence')
    mkdirSync(evidenceRoot)
    const index = join(evidenceRoot, 'gate-f-index.json')
    writeFileSync(index, '{}\n')
    replaceWithFifo(index)

    const result = runWithCapturedStderr([
      `--gate-f-index=${index}`,
      `--evidence-root=${evidenceRoot}`,
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'Gate F evidence index could not be read: Gate F index is not a regular file',
    )
  })

  it('refuses a referenced artifact that is not a regular file', () => {
    const bundle = layOutBundle()
    replaceWithFifo(
      join(bundle.root, 'evidence', 'gates', 'promotion.canary_window.json'),
    )

    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('gates.promotion.canary_window')
    expect(result.stderr).toContain('reference is not a regular file')
  })

  it('validates the index bytes it opened when the index path is rebound mid-read', () => {
    // The check-then-use defect this closes is not a file SHAPE, it is a
    // REBIND: `statSync(indexRealPath)` approves one inode and
    // `readFileSync(indexRealPath)` then reads whatever the name points at by
    // the time the read runs. Rebinding the index the instant the CLI first
    // touches it makes that gap decide the outcome — a path-based reader
    // validates the decoy, a descriptor-based reader cannot see it at all.
    const bundle = layOutBundle()
    const index = join(bundle.root, 'evidence', 'gate-f-index.json')
    armRebindOnFirstCheck(index, 'this decoy is not even JSON\n')

    const result = runWithCapturedStderr(bundle.args)

    // The findings are the complete bundle's own standing blocker, so the bytes
    // that reached the validator were the bytes behind the checked descriptor.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('release.legalRevisionSet:')
  })

  it('hashes the artifact bytes it opened when a reference path is rebound mid-read', () => {
    // Same rebind against the reference reader, where the consequence is a
    // digest: Gate F re-hashes every artifact against the index. Swapping the
    // canary artifact for a placeholder between the shape check and the read
    // makes a path-based reader hash the placeholder and report the gate as
    // tampered; reading the checked descriptor hashes the real artifact.
    const bundle = layOutBundle()
    const artifact = join(
      bundle.root,
      'evidence',
      'gates',
      'promotion.canary_window.json',
    )
    armRebindOnFirstCheck(artifact, '{"status":"passed"}\n')

    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('gates.promotion.canary_window')
    expect(result.stderr).toContain('release.legalRevisionSet:')
  })

  it('passes a contained Gate F index to the strict schema validator', () => {
    const root = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
    temporaryRoots.push(root)
    const index = join(root, 'gate-f-index.json')
    writeFileSync(index, '{}\n')

    const result = runWithCapturedStderr([`--gate-f-index=${index}`])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Gate F evidence index')
    expect(result.stderr).toContain('version')
  })

  it('reduces a complete, signed bundle to the ONE blocker that is really open', () => {
    // Every gate, every signature and every legal document digest checks out.
    // What remains is the launch blocker itself: the CLI validates against the
    // SHIPPED docs/legal/legal-document-registry.json, where every counsel row
    // is still a draft. This is the executable statement of "no external beta
    // before counsel approval".
    const bundle = layOutBundle()
    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('release.legalRevisionSet:')
    expect(result.stderr).not.toContain('approvals.')
    for (const gateId of CLOSED_BETA_GATE_IDS) {
      expect(result.stderr).not.toContain(`gates.${gateId}.evidence.0`)
    }
  })

  it('loads the TRACKED role key map by default, which fails closed today', () => {
    // security/gate-f-approval-roles.json enrols nobody yet, so the default
    // path must refuse rather than skip verification.
    const bundle = layOutBundle()
    const withoutOverride = bundle.args.filter(
      (arg) => !arg.startsWith('--approval-roles='),
    )
    const result = runWithCapturedStderr(withoutOverride)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('role_key_not_enrolled')
  })

  it.each(ALL_GATE_IDS)(
    'exits 1 and names %s when its artifact is replaced by a placeholder',
    (gateId) => {
      const bundle = layOutBundle({
        posture: 'open-beta',
        gateArtifacts: { [gateId]: '{"status":"passed"}\n' },
      })
      const result = runWithCapturedStderr(bundle.args)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`gates.${gateId}.evidence.0`)
    },
  )

  it.each(GATE_F_REQUIRED_APPROVAL_ROLES)(
    'exits 1 when the %s approval signature is removed',
    (role) => {
      const bundle = layOutBundle({ posture: 'ga', unsignedRoles: [role] })
      const result = runWithCapturedStderr(bundle.args)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`approvals.${role}.evidence`)
    },
  )

  it('exits 1 when the legal approval expired before Gate F completed', () => {
    const bundle = layOutBundle({
      legalChecklistExpiresAt: '2026-08-28T11:59:00.000Z',
    })
    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('release.legalApprovalChecklist')
  })

  it('exits 1 when the canary artifact was produced against the rehearsal project', () => {
    const base = completeGateFBundle()
    const bundle = layOutBundle({
      gateArtifacts: {
        'promotion.canary_window': rehearsalCanaryArtifact(base.files),
      },
    })
    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('gates.promotion.canary_window')
  })

  it('exits 1 when the legal revision set lists a draft document', () => {
    // LEG-01: the CLI surface, not just the library, must fail closed.
    const candidate = completeBundleCandidate()
    const context = legalRevisionSetContextFixture()
    const base = legalRevisionSetFixture(candidate, context)
    const bundle = layOutBundle({
      legalRevisionSetContent: canonicalLegalRevisionSetEvidence({
        ...base,
        documents: base.documents.map((document) =>
          document.id === 'privacy-notice'
            ? { ...document, status: 'draft' as const }
            : document,
        ),
      }),
    })
    const result = runWithCapturedStderr(bundle.args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(
      'release.legalRevisionSet: document privacy-notice is a draft and cannot appear in a release legal revision set',
    )
  })
})
