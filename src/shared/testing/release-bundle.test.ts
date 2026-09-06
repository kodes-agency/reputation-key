import { describe, expect, it } from 'vitest'
import {
  BETA_RELEASE_EVIDENCE_FILES,
  REQUIRED_BETA_LOCAL_GATE_IDS,
  createReleaseBundleMarker,
  createReleaseIdentityMarker,
  validateReleaseBundle,
  type ReleaseBundleManifest,
  type ReleaseGate,
  type ReleaseIdentity,
} from './release-bundle'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'

const identity: ReleaseIdentity = {
  releaseId: 'beta-rc-2026-08-08.1',
  releaseSha: 'a'.repeat(40),
  lockfileSha256: 'b'.repeat(64),
  artifactDigest: `sha256:${'c'.repeat(64)}`,
  migrationVersion: '0000_baseline',
  capabilityPolicyVersion: 'bqc-0.3',
  sourceContentPolicyVersion: 2,
  routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  datasetHash: 'd'.repeat(64),
  environment: 'cell-us',
  generatedAt: '2026-08-08T10:00:00.000Z',
}

const manifest: ReleaseBundleManifest = {
  identity,
  findings: [
    {
      id: 'SPEC-P1-04',
      severity: 'P1',
      state: 'accepted',
      acceptedAt: '2026-08-08T11:00:00.000Z',
    },
    {
      id: 'SPEC-P2-02',
      severity: 'P2',
      state: 'exception',
      exception: {
        owner: 'operations',
        impact: 'No impact on the internal synthetic staging candidate.',
        mitigation: 'Keep the capability dark until the evidence is rerun.',
        expiresAt: '2026-08-15T00:00:00.000Z',
        targetPhase: 'BQC-9',
        approvedBy: 'security/privacy',
      },
    },
  ],
  gates: REQUIRED_BETA_LOCAL_GATE_IDS.map<ReleaseGate>((id) => ({
    id,
    required: true,
    status: 'passed',
    completedAt: '2026-08-08T12:30:00.000Z',
    evidence:
      id === 'security-privacy'
        ? 'security-and-privacy.md'
        : id === 'local-scale-recovery' ||
            id === 'source-lifecycle' ||
            id === 'runtime-fault-matrix'
          ? 'scale-and-recovery.md'
          : 'quality-gates.md',
  })),
  approvals: [
    {
      role: 'engineering/runtime',
      approvedAt: '2026-08-08T13:00:00.000Z',
      reviewer: 'eng-reviewer',
    },
    {
      role: 'product/property',
      approvedAt: '2026-08-08T13:01:00.000Z',
      reviewer: 'product-reviewer',
    },
    {
      role: 'security/privacy',
      approvedAt: '2026-08-08T13:02:00.000Z',
      reviewer: 'security-reviewer',
    },
    {
      role: 'google-project/integration',
      approvedAt: '2026-08-08T13:03:00.000Z',
      reviewer: 'google-reviewer',
    },
    {
      role: 'operations/on-call',
      approvedAt: '2026-08-08T13:04:00.000Z',
      reviewer: 'ops-reviewer',
    },
  ],
}

function validBundle(overrides: Partial<Record<string, string>> = {}) {
  const files = new Map<string, string>()
  for (const path of BETA_RELEASE_EVIDENCE_FILES) {
    files.set(
      path,
      `${createReleaseIdentityMarker(identity)}\n\nMeasured evidence for ${path}.`,
    )
  }
  files.set(
    'manifest.md',
    `${createReleaseIdentityMarker(identity)}\n${createReleaseBundleMarker(manifest)}\n\nImmutable candidate manifest.`,
  )
  files.set(
    'scale-dataset.json',
    JSON.stringify({
      seed: 'perf-scale-v1',
      version: 3,
      shape: { orgs: 100, properties: 5000, reviews: 500000 },
      hash: identity.datasetHash,
      createdAt: '2026-08-08T10:00:00.000Z',
    }),
  )
  for (const [path, content] of Object.entries(overrides)) {
    if (content != null) files.set(path, content)
  }
  return files
}

describe('validateReleaseBundle', () => {
  it('accepts a complete immutable candidate with accepted findings and named approvals', () => {
    const result = validateReleaseBundle(validBundle())

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('rejects a bundle that omits a mandatory BQC8 execution gate', () => {
    const incomplete: ReleaseBundleManifest = {
      ...manifest,
      gates: manifest.gates.filter((gate) => gate.id !== 'source-lifecycle'),
    }
    const result = validateReleaseBundle(
      validBundle({
        'manifest.md': `${createReleaseIdentityMarker(identity)}\n${createReleaseBundleMarker(incomplete)}\n\nImmutable candidate manifest.`,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('missing required gate: source-lifecycle')
  })

  it('rejects missing or template evidence before it can be called a release bundle', () => {
    const files = validBundle({
      'quality-gates.md': `${createReleaseIdentityMarker(identity)}\n\nTODO: run final gates`,
    })
    files.delete('regional-execution.md')

    const result = validateReleaseBundle(files)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'missing required evidence file: regional-execution.md',
    )
    expect(result.errors).toContain('template or pending content in quality-gates.md')
  })

  it('rejects a document from a different release identity', () => {
    const otherIdentity = { ...identity, releaseSha: 'e'.repeat(40) }
    const result = validateReleaseBundle(
      validBundle({
        'security-and-privacy.md': `${createReleaseIdentityMarker(otherIdentity)}\n\nMeasured final-artifact scan.`,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'release identity mismatch in security-and-privacy.md',
    )
  })

  it('rejects unaccepted P0/P1 findings, non-passing gates, and approvals before final evidence', () => {
    const invalidManifest: ReleaseBundleManifest = {
      ...manifest,
      findings: [{ id: 'STD-P0-01', severity: 'P0', state: 'open' }],
      gates: [
        {
          id: 'restore',
          required: true,
          status: 'pending',
          completedAt: '2026-08-08T12:30:00.000Z',
          evidence: 'scale-and-recovery.md',
        },
      ],
      approvals: [
        {
          role: 'engineering/runtime',
          approvedAt: '2026-08-08T09:00:00.000Z',
          reviewer: 'eng-reviewer',
        },
      ],
    }

    const result = validateReleaseBundle(
      validBundle({
        'manifest.md': `${createReleaseIdentityMarker(identity)}\n${createReleaseBundleMarker(invalidManifest)}\n\nImmutable candidate manifest.`,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('P0/P1 finding STD-P0-01 is not accepted')
    expect(result.errors).toContain('required gate restore is pending')
    expect(result.errors).toContain('missing required approval role: product/property')
    expect(result.errors).toContain(
      'approval engineering/runtime predates final evidence',
    )
  })
})
