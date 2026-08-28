import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GATE_F_REQUIRED_APPROVAL_ROLES,
  GATE_F_REQUIRED_GATE_IDS,
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

const temporaryRoots: string[] = []

afterEach(() => {
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
    for (const gateId of GATE_F_REQUIRED_GATE_IDS) {
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

  it.each(GATE_F_REQUIRED_GATE_IDS)(
    'exits 1 and names %s when its artifact is replaced by a placeholder',
    (gateId) => {
      const bundle = layOutBundle({
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
      const bundle = layOutBundle({ unsignedRoles: [role] })
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
