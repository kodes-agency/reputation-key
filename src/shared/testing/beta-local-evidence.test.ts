import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BETA_LOCAL_APPROVAL_VERSION,
  canonicalJson,
  executeBetaSmokeGates,
  parseBetaSmokeManifest,
  sha256,
  persistBetaSmokeManifest,
  promoteLocalEvidence,
  validatePromotionEvidence,
  validatePromotedLocalEvidence,
  type BetaGatePlan,
  type BetaLocalApproval,
  type BetaSmokeIdentity,
  type BetaSmokeManifest,
} from './beta-local-evidence'
import {
  BETA_LOCAL_EVIDENCE_VERSION,
  REQUIRED_APPROVAL_ROLES,
  REQUIRED_BETA_LOCAL_GATE_IDS,
} from './release-bundle'
import {
  buildBetaSmokeIdentity,
  createBetaSmokeGatePlan,
  createStackAcceptanceCommand,
  runBetaSmokeCli,
} from '../../../scripts/beta/smoke'
import { createPreCutoverDump } from '../../../scripts/beta/create-pre-cutover-dump'

const identity: BetaSmokeIdentity = {
  releaseSha: 'a'.repeat(40),
  sourceRevision: 'a'.repeat(40),
  lockfileRevision: 'c'.repeat(64),
  cleanMigrationHead: '0021_clean',
  upgradeMigrationHead: '0021_upgrade',
  capabilityPolicyVersion: 'beta-policy-4',
  stackContractHash: '9'.repeat(64),
  productHash: 'd'.repeat(64),
  scaleHash: 'e'.repeat(64),
  fleetHash: 'f'.repeat(64),
  imageDigests: {
    web: `sha256:${'1'.repeat(64)}`,
    worker: `sha256:${'2'.repeat(64)}`,
    provider: `sha256:${'3'.repeat(64)}`,
    perf: `sha256:${'4'.repeat(64)}`,
  },
}
const identityObservationContent = canonicalJson({
  schemaVersion: 'beta-local-1',
  evidenceKind: 'observed-beta-smoke-identity',
  identity,
  acceptanceIndexSha256: '8'.repeat(64),
})

const plan: readonly BetaGatePlan[] = REQUIRED_BETA_LOCAL_GATE_IDS.map((id) => ({
  id,
  command: { executable: 'gate-runner', args: [id] },
  evidence: [`test-results/gates/${id}.json`],
}))

const manifest: BetaSmokeManifest = {
  version: BETA_LOCAL_EVIDENCE_VERSION,
  identity,
  startedAt: '2026-08-09T10:00:00.000Z',
  completedAt: '2026-08-09T10:30:00.000Z',
  gates: REQUIRED_BETA_LOCAL_GATE_IDS.map((id) => ({
    id,
    status: 'passed',
    command: { executable: 'gate-runner', args: [id] },
    startedAt: '2026-08-09T10:00:00.000Z',
    completedAt: '2026-08-09T10:01:00.000Z',
    exitCode: 0,
    outputSha256: '3'.repeat(64),
    evidence:
      id === 'release-bundle'
        ? [
            {
              path: 'test-results/gates/release-bundle.json',
              sha256: sha256('evidence for release-bundle'),
            },
            {
              path: 'test-results/gates/identity-observation.json',
              sha256: sha256(identityObservationContent),
            },
          ]
        : [
            {
              path: `test-results/gates/${id}.json`,
              sha256: sha256(`evidence for ${id}`),
            },
          ],
  })),
}

const manifestContent = canonicalJson(manifest)
const manifestSha256 = sha256(manifestContent)
const checksumContent = `${manifestSha256}  manifest.json\n`

const approvalFiles = new Map<string, string>(
  REQUIRED_APPROVAL_ROLES.map<[string, string]>((role, index) => {
    const approval: BetaLocalApproval = {
      version: BETA_LOCAL_APPROVAL_VERSION,
      role,
      approverIdentity: `reviewer-${index + 1}@example.test`,
      approvedAt: `2026-08-09T11:0${index}:00.000Z`,
      manifestSha256,
      binding: identity,
    }
    return [`approval-${index + 1}.json`, canonicalJson(approval)]
  }),
)

describe('createPreCutoverDump', () => {
  it('creates a deterministic legacy fixture with real migrations left pending', () => {
    const root = mkdtempSync(join(tmpdir(), 'beta-pre-cutover-'))
    try {
      const output = join(root, 'beta-local-1-pre-cutover-0021.sql')
      const first = createPreCutoverDump(output)
      const content = readFileSync(output, 'utf8')
      const second = createPreCutoverDump(output)

      expect(first).toEqual(second)
      expect(first.migrationHead).toBe('0021_demonic_misty_knight')
      expect(content).toContain('0021_demonic_misty_knight')
      expect(content).not.toContain('0022_guest-response-lifecycle')
      expect(content).toContain('beta_local_pre_cutover_fixture')
      expect(content).toContain('"legacyAssignments":true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildBetaSmokeIdentity', () => {
  const observedImages = Object.fromEntries(
    ['web', 'worker', 'provider', 'perf'].map((name, index) => [
      name,
      {
        imageId: `sha256:${String(index + 4).repeat(64)}`,
        revisionLabel: 'a'.repeat(40),
      },
    ]),
  )
  const acceptance = {
    sourceRevision: 'a'.repeat(40),
    cleanMigrationHead: { expectedTag: '0023_guest-tenant-invariants' },
    upgradeMigrationHead: { expectedTag: '0023_guest-tenant-invariants' },
    stackContractSha256: '5'.repeat(64),
    scaleFixtureSha256: '6'.repeat(64),
    fleetFixtureSha256: '7'.repeat(64),
    images: observedImages,
  }

  it('derives identity only from matching observed acceptance and image evidence', () => {
    const inspectedImageIds = Object.fromEntries(
      Object.entries(observedImages).map(([name, image]) => [name, image.imageId]),
    )
    const result = buildBetaSmokeIdentity({
      releaseSha: 'a'.repeat(40),
      acceptance,
      lockfileContent: Buffer.from('lockfile'),
      productContractContent: Buffer.from('product contract'),
      inspectedImageIds,
    })

    expect(result).toMatchObject({
      sourceRevision: 'a'.repeat(40),
      stackContractHash: '5'.repeat(64),
      scaleHash: '6'.repeat(64),
      fleetHash: '7'.repeat(64),
      imageDigests: inspectedImageIds,
    })
  })

  it('rejects caller revision or image values that differ from observations', () => {
    expect(() =>
      buildBetaSmokeIdentity({
        releaseSha: 'b'.repeat(40),
        acceptance,
        lockfileContent: Buffer.from('lockfile'),
        productContractContent: Buffer.from('product contract'),
        inspectedImageIds: {},
      }),
    ).toThrow('release SHA does not match observed stack source revision')
    expect(() =>
      buildBetaSmokeIdentity({
        releaseSha: 'a'.repeat(40),
        acceptance,
        lockfileContent: Buffer.from('lockfile'),
        productContractContent: Buffer.from('product contract'),
        inspectedImageIds: {
          web: `sha256:${'0'.repeat(64)}`,
        },
      }),
    ).toThrow('acceptance image web does not match docker inspect')
  })
})

describe('createBetaSmokeGatePlan', () => {
  it('owns the exact stack acceptance and promoted browser journey sequence', () => {
    const exactPlan = createBetaSmokeGatePlan(identity)

    expect(exactPlan.map((gate) => gate.id)).toEqual(REQUIRED_BETA_LOCAL_GATE_IDS)
    expect(createStackAcceptanceCommand('/fixtures/pre-cutover.sql')).toEqual({
      executable: 'pnpm',
      args: [
        'exec',
        'tsx',
        'scripts/local-stack/stack.ts',
        'acceptance',
        '--mode=beta',
        '--pre-cutover-dump=/fixtures/pre-cutover.sql',
      ],
    })
    expect(exactPlan.find((gate) => gate.id === 'local-scale-recovery')?.command).toEqual(
      {
        executable: 'pnpm',
        args: [
          'exec',
          'tsx',
          'scripts/beta/verify-gate-evidence.ts',
          '--kind=scale',
          '--path=test-results/local-stack/beta/acceptance/scale.json',
        ],
      },
    )
    expect(
      exactPlan.find((gate) => gate.id === 'product-journeys')?.command.args,
    ).toContain('scripts/beta/run-product-journeys.ts')
    expect(exactPlan.find((gate) => gate.id === 'product-journeys')?.evidence).toEqual([
      'test-results/beta-smoke-work/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/product-journeys.json',
      'test-results/beta-smoke-work/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/product-journeys.json.report.json',
    ])
    // The quality phase is gone: it re-ran format/lint/typecheck/unit/
    // integration/builds/storybook/both e2e projects that beta-acceptance's own
    // `needs` already prove on the same SHA. Assert it stays gone, so nobody
    // reintroduces the long pole by accident.
    expect(exactPlan.map((gate) => gate.id)).not.toContain('quality')
    expect(exactPlan.find((gate) => gate.id === 'migration-upgrade')?.evidence).toEqual([
      'test-results/local-stack/beta/acceptance/clean-smoke.json',
      'test-results/local-stack/beta/acceptance/upgrade.json',
    ])
  })
})
describe('runBetaSmokeCli', () => {
  it('writes no success manifest when stack acceptance fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beta-smoke-failure-'))
    try {
      const dump = join(root, 'pre-cutover.sql')
      writeFileSync(dump, 'SELECT 1;')
      let invocation = 0
      const exitCode = await runBetaSmokeCli(
        [
          `--release-sha=${'a'.repeat(40)}`,
          `--pre-cutover-dump=${dump}`,
          `--output-root=${join(root, 'evidence')}`,
        ],
        async () => {
          invocation += 1
          return invocation === 1
            ? { exitCode: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' }
            : { exitCode: 9, stdout: '', stderr: 'acceptance failed' }
        },
      )

      expect(exitCode).toBe(1)
      expect(existsSync(join(root, 'evidence', 'a'.repeat(40)))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('executeBetaSmokeGates', () => {
  it('returns no success manifest when a named gate fails', async () => {
    const result = await executeBetaSmokeGates({
      identity,
      plan,
      readEvidence: (path) => `evidence for ${basename(path, '.json')}`,
      runner: async (command) => ({
        exitCode: command.args[0] === 'runtime-fault-matrix' ? 9 : 0,
        stdout: '',
        stderr: command.args[0] === 'runtime-fault-matrix' ? 'fault gate failed' : '',
      }),
    })

    expect(result).toEqual({
      ok: false,
      failedGate: 'runtime-fault-matrix',
      exitCode: 9,
      stderr: 'fault gate failed',
    })
    expect('manifest' in result).toBe(false)
  })

  it('binds every required named gate and command output to the manifest', async () => {
    let tick = 0
    const result = await executeBetaSmokeGates({
      identity,
      plan,
      readEvidence: (path) => `evidence for ${basename(path, '.json')}`,
      runner: async (command) => ({
        exitCode: 0,
        stdout: `passed ${command.args[0]}`,
        stderr: '',
      }),
      now: () => new Date(Date.UTC(2026, 7, 9, 10, 0, tick++)),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.identity).toEqual(identity)
    expect(result.manifest.gates.map((gate) => gate.id)).toEqual(
      REQUIRED_BETA_LOCAL_GATE_IDS,
    )
    expect(parseBetaSmokeManifest(canonicalJson(result.manifest)).errors).toEqual([])
  })
})

describe('validatePromotionEvidence', () => {
  it('detects manifest mutation through the immutable checksum', () => {
    const mutated = JSON.parse(manifestContent) as BetaSmokeManifest
    const mutatedContent = canonicalJson({
      ...mutated,
      identity: { ...mutated.identity, productHash: '0'.repeat(64) },
    })

    const result = validatePromotionEvidence({
      manifestContent: mutatedContent,
      checksumContent,
      approvalFiles,
    })

    expect(result.errors).toContain('manifest checksum does not match manifest.json')
  })

  it('rejects a missing approval role', () => {
    const missing = new Map(approvalFiles)
    missing.delete('approval-5.json')

    const result = validatePromotionEvidence({
      manifestContent,
      checksumContent,
      approvalFiles: missing,
    })

    expect(result.errors).toContain('missing required approval role: operations/on-call')
  })

  it('rejects an approval created before final evidence', () => {
    const early = new Map(approvalFiles)
    const value = JSON.parse(early.get('approval-1.json') ?? '') as BetaLocalApproval
    early.set(
      'approval-1.json',
      canonicalJson({ ...value, approvedAt: '2026-08-09T10:29:59.000Z' }),
    )

    const result = validatePromotionEvidence({
      manifestContent,
      checksumContent,
      approvalFiles: early,
    })

    expect(result.errors).toContain(
      'approval engineering/runtime does not postdate final evidence',
    )
  })

  it('rejects duplicate roles even when approval filenames differ', () => {
    const duplicate = new Map(approvalFiles)
    duplicate.set('duplicate.json', approvalFiles.get('approval-1.json') ?? '')

    const result = validatePromotionEvidence({
      manifestContent,
      checksumContent,
      approvalFiles: duplicate,
    })

    expect(result.errors).toContain('duplicate approval role: engineering/runtime')
  })

  it('rejects manifest, revision, migration head, or digest binding mismatches', () => {
    const mismatch = new Map(approvalFiles)
    const value = JSON.parse(mismatch.get('approval-3.json') ?? '') as BetaLocalApproval
    mismatch.set(
      'approval-3.json',
      canonicalJson({
        ...value,
        binding: {
          ...value.binding,
          upgradeMigrationHead: '0020_wrong',
          imageDigests: {
            ...value.binding.imageDigests,
            web: `sha256:${'9'.repeat(64)}`,
          },
        },
      }),
    )

    const result = validatePromotionEvidence({
      manifestContent,
      checksumContent,
      approvalFiles: mismatch,
    })

    expect(result.errors).toContain(
      'approval security/privacy has mismatched identity binding',
    )
  })

  it('accepts exactly the five explicit post-evidence role approvals', () => {
    const result = validatePromotionEvidence({
      manifestContent,
      checksumContent,
      approvalFiles,
    })

    expect(result).toMatchObject({
      ok: true,
      errors: [],
      manifestSha256,
    })
    expect(result.approvals).toBeDefined()
    if (!result.approvals) return
    expect([...result.approvals.keys()]).toEqual(REQUIRED_APPROVAL_ROLES)
  })
})

describe('immutable local evidence files', () => {
  it('creates one digest-keyed manifest per release SHA and rejects overwrite or reuse', () => {
    const root = mkdtempSync(join(tmpdir(), 'beta-smoke-evidence-'))
    try {
      const persisted = persistBetaSmokeManifest({
        outputRoot: root,
        manifest,
      })
      expect(persisted.manifestSha256).toBe(manifestSha256)
      expect(readFileSync(persisted.checksumPath, 'utf8')).toBe(checksumContent)
      expect(() => persistBetaSmokeManifest({ outputRoot: root, manifest })).toThrow(
        `release SHA ${identity.releaseSha} already has evidence`,
      )
      expect(() =>
        persistBetaSmokeManifest({
          outputRoot: root,
          manifest: {
            ...manifest,
            completedAt: '2026-08-09T10:31:00.000Z',
          },
        }),
      ).toThrow(`release SHA ${identity.releaseSha} already has evidence`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('copies five explicit approvals once and validates the promoted index', () => {
    const root = mkdtempSync(join(tmpdir(), 'beta-promotion-'))
    try {
      const sourceDir = join(root, 'smoke', identity.releaseSha, manifestSha256)
      const approvalsDir = join(root, 'approvals')
      const evidenceRoot = join(root, 'published')
      const gateEvidenceRoot = join(root, 'gate-evidence')
      mkdirSync(sourceDir, { recursive: true })
      mkdirSync(approvalsDir)
      writeFileSync(join(sourceDir, 'manifest.json'), manifestContent)
      writeFileSync(join(sourceDir, 'manifest.sha256'), checksumContent)
      for (const [filename, content] of approvalFiles)
        writeFileSync(join(approvalsDir, filename), content)
      expect(() =>
        promoteLocalEvidence({
          manifestPath: join(sourceDir, 'manifest.json'),
          approvalsDir,
          evidenceRoot,
          gateEvidenceRoot,
        }),
      ).toThrow('missing gate evidence file: test-results/gates/security-privacy.json')
      for (const gate of manifest.gates) {
        for (const evidence of gate.evidence) {
          const path = join(gateEvidenceRoot, evidence.path)
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(
            path,
            evidence.path.endsWith('identity-observation.json')
              ? identityObservationContent
              : `evidence for ${gate.id}`,
          )
        }
      }

      const promoted = promoteLocalEvidence({
        manifestPath: join(sourceDir, 'manifest.json'),
        approvalsDir,
        evidenceRoot,
        gateEvidenceRoot,
      })
      const validation = validatePromotedLocalEvidence({
        releaseDir: join(evidenceRoot, identity.releaseSha),
        expectedManifestSha256: manifestSha256,
      })

      expect(validation.ok).toBe(true)
      expect(readFileSync(join(promoted.bundleDir, 'manifest.json'), 'utf8')).toBe(
        manifestContent,
      )
      expect(() =>
        promoteLocalEvidence({
          manifestPath: join(sourceDir, 'manifest.json'),
          approvalsDir,
          evidenceRoot,
          gateEvidenceRoot,
        }),
      ).toThrow(`release SHA ${identity.releaseSha} has already been promoted`)
      const firstEvidence = manifest.gates[0]?.evidence[0]
      if (!firstEvidence) throw new Error('test fixture is missing gate evidence')
      const publishedGateEvidence = join(
        promoted.bundleDir,
        'evidence',
        firstEvidence.path,
      )
      writeFileSync(publishedGateEvidence, 'tampered gate evidence')
      const tamperedGate = validatePromotedLocalEvidence({
        releaseDir: join(evidenceRoot, identity.releaseSha),
      })
      expect(tamperedGate.errors).toContain(
        `local gate evidence checksum mismatch: ${firstEvidence.path}`,
      )
      writeFileSync(publishedGateEvidence, 'evidence for quality')
      const publishedApproval = join(
        promoted.bundleDir,
        'approvals',
        'engineering__runtime.json',
      )
      writeFileSync(
        publishedApproval,
        readFileSync(publishedApproval, 'utf8').replace(
          'reviewer-1@example.test',
          'tampered@example.test',
        ),
      )
      const tampered = validatePromotedLocalEvidence({
        releaseDir: join(evidenceRoot, identity.releaseSha),
      })
      expect(tampered.errors).toContain(
        'local evidence approval checksum mismatch: engineering/runtime',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
