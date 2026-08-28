import { describe, expect, it } from 'vitest'
import {
  PROMOTED_IMAGE_REPOSITORIES,
  PROMOTED_IMAGE_ROLES,
  PROMOTION_MANIFEST_VERSION,
  TRUSTED_RELEASE_REPOSITORY,
  TRUSTED_RELEASE_WORKFLOW_IDENTITY,
  canonicalPromotionManifest,
  promotionManifestSha256,
  type PromotionManifest,
} from './promotion-manifest'
import {
  RELEASE_BUILDKIT_IMAGE,
  RELEASE_BUILDKIT_VERSION,
  RELEASE_BUILDX_VERSION,
  RELEASE_DOCKER_VERSION,
  RELEASE_RUNNER_ARCHITECTURE,
  RELEASE_RUNNER_IMAGE_OS,
  RELEASE_RUNNER_LABEL,
} from './release-build-toolchain'
import {
  GATE_F_EVIDENCE_VERSION,
  GATE_F_REQUIRED_APPROVAL_ROLES,
  GATE_F_REQUIRED_GATE_IDS,
  canonicalGateFEvidence,
  gateFEvidenceSha256,
  parseGateFEvidence,
  validateGateFEvidenceBundle,
  type GateFEvidence,
  type GateFEvidenceReference,
} from './gate-f-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import { gateFLiveEvidenceFixtures } from './gate-f-live-evidence.test-fixtures'
import {
  canonicalReleaseEvidence,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'
import {
  legalRevisionSetContextFixture,
  legalRevisionSetFixture,
  legalRevisionSetFixtureContent,
} from './legal-revision-set-evidence.test-fixtures'
import { canonicalLegalRevisionSetEvidence } from './legal-revision-set-evidence'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

/**
 * LEG-01: the legal revision set is validated against the legal document
 * registry, and every counsel row in the SHIPPED registry is a draft. The
 * happy-path fixture therefore has to run against a registry in which counsel
 * has signed; the last test in this file asserts the shipped default fails.
 */
const LEGAL_CONTEXT = legalRevisionSetContextFixture()

function promotionManifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-28T08:00:00.000Z',
    source: { repository: TRUSTED_RELEASE_REPOSITORY, ref: 'refs/heads/main' },
    ci: {
      workflowIdentity: TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      runId: '1234',
      runAttempt: 1,
    },
    build: {
      runnerLabel: RELEASE_RUNNER_LABEL,
      runnerImageOS: RELEASE_RUNNER_IMAGE_OS,
      runnerImageVersion: '20260824.1.0',
      runnerArchitecture: RELEASE_RUNNER_ARCHITECTURE,
      dockerVersion: RELEASE_DOCKER_VERSION,
      buildxVersion: RELEASE_BUILDX_VERSION,
      buildkitVersion: RELEASE_BUILDKIT_VERSION,
      buildkitImage: RELEASE_BUILDKIT_IMAGE,
      imageMetadataIndexSha256: digest('e'),
    },
    contract: {
      lockfileSha256: digest('1'),
      iacSha256: digest('2'),
      releaseControllerSha256: digest('3'),
      migrationHead: '0140_single_us_data_cell_cutover',
      capabilityPolicyVersion: 'beta-us-1',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: digest('4'),
      testEvidenceSha256: digest('5'),
      providerApprovalEvidenceSha256: digest('6'),
      sbomIndexSha256: digest('7'),
      vulnerabilityIndexSha256: digest('8'),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
          digest: `sha256:${digest(String((index % 8) + 1))}`,
          sourceRevision: releaseSha,
          sbomSha256: digest('9'),
          provenanceSha256: digest('a'),
          signatureBundleSha256: digest('b'),
          vulnerabilityReportSha256: digest('c'),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

/** The one release target every artifact in this bundle must bind. */
function fixtureCandidate(
  overrides: Partial<ReleaseCandidateBinding> = {},
): ReleaseCandidateBinding {
  const manifest = promotionManifest()
  return {
    releaseSha: manifest.releaseSha,
    releaseManifestSha256: promotionManifestSha256(canonicalPromotionManifest(manifest)),
    cell: 'us',
    environment: 'cell-us',
    deploymentProfile: 'production',
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    projectId: 'railway-project-us-production',
    environmentId: 'railway-environment-cell-us',
    appOrigin: 'https://us.reputationkey.app',
    ...overrides,
  }
}

type GateFFixture = Readonly<{
  evidence: GateFEvidence
  content: string
  files: Map<string, Uint8Array>
}>

function gateFFixture(legalRevisionSetContent?: string): GateFFixture {
  const files = new Map<string, Uint8Array>()
  const capturedAt = '2026-08-28T10:00:00.000Z'
  const addEvidence = (
    path: string,
    value: string,
    timestamp = capturedAt,
  ): GateFEvidenceReference => {
    const payload = Buffer.from(`${value}\n`)
    files.set(path, payload)
    return { path, sha256: gateFEvidenceSha256(payload), capturedAt: timestamp }
  }
  const addPayload = (
    path: string,
    payload: string,
    timestamp = capturedAt,
  ): GateFEvidenceReference => {
    const bytes = Buffer.from(payload)
    files.set(path, bytes)
    return { path, sha256: gateFEvidenceSha256(bytes), capturedAt: timestamp }
  }

  const manifest = promotionManifest()
  const manifestContent = canonicalPromotionManifest(manifest)
  const manifestPath = 'release/promotion-manifest.json'
  files.set(manifestPath, Buffer.from(manifestContent))
  const manifestReference = {
    path: manifestPath,
    sha256: promotionManifestSha256(manifestContent),
    capturedAt,
  }
  const candidate = fixtureCandidate()
  // LEG-01: a REAL typed revision set. The stub this replaced —
  // `{"privacy":"2026-08-28","terms":"2026-08-28"}` — is exactly the fail-open
  // Gate F used to have: any bytes satisfied the strongest legal control in
  // the program.
  const legalRevisionSet = addPayload(
    'legal/revision-set.json',
    legalRevisionSetContent ?? legalRevisionSetFixtureContent(candidate, LEGAL_CONTEXT),
  )
  const approvalEvidenceAt = '2026-08-28T11:01:00.000Z'
  const approvalBase = (role: string) => ({
    approverIdentity: `${role}-approver`,
    approvedAt: '2026-08-28T11:00:00.000Z',
    releaseManifestSha256: manifestReference.sha256,
    evidence: addEvidence(
      `approvals/${role}.json`,
      `${role} approval`,
      approvalEvidenceAt,
    ),
  })
  const livePromotionEvidence = gateFLiveEvidenceFixtures(candidate)

  const evidence: GateFEvidence = {
    version: GATE_F_EVIDENCE_VERSION,
    release: {
      manifest: manifestReference,
      signatureBundle: addEvidence(
        'release/promotion-manifest.sigstore.json',
        '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}',
      ),
      legalRevisionSet,
      releaseSha: manifest.releaseSha,
      cell: 'us',
      environment: 'cell-us',
      deploymentProfile: 'production',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: 'railway-project-us-production',
      environmentId: 'railway-environment-cell-us',
      appOrigin: 'https://us.reputationkey.app',
    },
    gates: GATE_F_REQUIRED_GATE_IDS.map((id) => {
      const typedEvidence = livePromotionEvidence[id]
      return {
        id,
        status: 'passed',
        evidence:
          typedEvidence == null
            ? [addEvidence(`gates/${id}.json`, `${id} passed`)]
            : [
                addPayload(`gates/${id}.json`, typedEvidence.content),
                ...typedEvidence.dependencies.map((dependency) =>
                  addPayload(dependency.path, dependency.payload, dependency.capturedAt),
                ),
              ],
      }
    }),
    findings: {
      protectedReachableHighCount: 0,
      register: addEvidence('findings/register.json', 'no protected reachable High'),
    },
    approvals: [
      {
        role: 'counsel',
        ...approvalBase('counsel'),
        legalRevisionSetSha256: legalRevisionSet.sha256,
      },
      {
        role: 'founder',
        ...approvalBase('founder'),
        legalRevisionSetSha256: legalRevisionSet.sha256,
      },
      { role: 'operations', ...approvalBase('operations') },
      { role: 'product', ...approvalBase('product') },
      { role: 'security', ...approvalBase('security') },
      { role: 'support_incident', ...approvalBase('support_incident') },
    ],
    firstCohort: {
      kind: 'design_partner',
      cohortReferenceSha256: digest('d'),
      supportOwner: 'support-owner',
      incidentOwner: 'incident-owner',
      changeRecord: 'CHG-REL-01-001',
      evidence: addEvidence('cohort/readiness.json', 'bounded cohort ready'),
    },
    completedAt: '2026-08-28T12:00:00.000Z',
  }
  return { evidence, content: canonicalGateFEvidence(evidence), files }
}

function readFixture(fixture: GateFFixture): (path: string) => Uint8Array {
  return (path) => {
    const payload = fixture.files.get(path)
    if (!payload) throw new Error(`missing fixture ${path}`)
    return payload
  }
}

function validateContent(content: string, fixture: GateFFixture) {
  return validateGateFEvidenceBundle(content, readFixture(fixture), LEGAL_CONTEXT)
}

function validateFixture(fixture: GateFFixture) {
  return validateContent(fixture.content, fixture)
}

describe('Gate F release evidence', () => {
  it('accepts only a complete, canonical and byte-bound single-US evidence join', () => {
    const fixture = gateFFixture()

    expect(parseGateFEvidence(fixture.content)).toMatchObject({
      ok: true,
      digest: gateFEvidenceSha256(fixture.content),
    })
    expect(validateFixture(fixture)).toMatchObject({
      ok: true,
      digest: gateFEvidenceSha256(fixture.content),
    })
    expect(fixture.evidence.gates.map(({ id }) => id)).toEqual(GATE_F_REQUIRED_GATE_IDS)
    expect(fixture.evidence.approvals.map(({ role }) => role)).toEqual(
      GATE_F_REQUIRED_APPROVAL_ROLES,
    )
  })

  it('rejects a referenced artifact changed after the completion index was written', () => {
    const fixture = gateFFixture()
    const firstGatePath = fixture.evidence.gates[0].evidence[0]?.path
    expect(firstGatePath).toBeDefined()
    fixture.files.set(String(firstGatePath), Buffer.from('changed after approval\n'))

    const result = validateFixture(fixture)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('evidence digest mismatch')
  })

  it('rejects a missing required gate even when every retained reference is valid', () => {
    const fixture = gateFFixture()
    const incomplete = {
      ...fixture.evidence,
      gates: fixture.evidence.gates.slice(1),
    } as GateFEvidence
    const result = parseGateFEvidence(canonicalGateFEvidence(incomplete))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        `missing required Gate F gate ${GATE_F_REQUIRED_GATE_IDS[0]}`,
      )
    }
  })

  it('rejects approvals that do not bind the final manifest and legal revision set', () => {
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'counsel'
        ? {
            ...approval,
            releaseManifestSha256: digest('e'),
            legalRevisionSetSha256: digest('f'),
          }
        : approval,
    ) as GateFEvidence['approvals']
    const invalid = { ...fixture.evidence, approvals }
    const result = parseGateFEvidence(canonicalGateFEvidence(invalid))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approval must bind the release manifest digest',
      )
      expect(result.errors.join('\n')).toContain(
        'counsel and founder must bind the legal revision-set digest',
      )
    }
  })

  it('rejects completion recorded before approval evidence was captured', () => {
    const fixture = gateFFixture()
    const invalid = {
      ...fixture.evidence,
      completedAt: '2026-08-28T11:00:30.000Z',
    }
    const result = parseGateFEvidence(canonicalGateFEvidence(invalid))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'completion predates evidence or approval',
      )
    }
  })

  it('rejects an approval captured before the final decision evidence', () => {
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'operations'
        ? { ...approval, approvedAt: '2026-08-28T09:59:59.000Z' }
        : approval,
    ) as GateFEvidence['approvals']
    const result = parseGateFEvidence(
      canonicalGateFEvidence({ ...fixture.evidence, approvals }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approval predates final release evidence',
      )
    }
  })

  it('rejects a promotion manifest from a different release candidate', () => {
    const fixture = gateFFixture()
    const invalid = {
      ...fixture.evidence,
      release: { ...fixture.evidence.release, releaseSha: 'b'.repeat(40) },
    }
    const result = validateContent(canonicalGateFEvidence(invalid), fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(
        'release.manifest: release SHA does not match Gate F index',
      )
    }
  })

  it('rejects a generic placeholder for a typed live promotion gate', () => {
    const fixture = gateFFixture()
    const gate = fixture.evidence.gates.find(({ id }) => id === 'promotion.canary_window')
    const reference = gate?.evidence[0]
    expect(reference).toBeDefined()
    const payload = Buffer.from('{"passed":true}\n')
    fixture.files.set(String(reference?.path), payload)
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.canary_window'
        ? {
            ...entry,
            evidence: [
              {
                ...entry.evidence[0],
                sha256: gateFEvidenceSha256(payload),
              },
            ],
          }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'gates.promotion.canary_window.evidence.0',
      )
    }
  })

  it('rejects typed promotion evidence bound to another candidate', () => {
    const fixture = gateFFixture()
    const gate = fixture.evidence.gates.find(
      ({ id }) => id === 'promotion.deployed_critical_journeys',
    )
    const reference = gate?.evidence[0]
    const original = fixture.files.get(String(reference?.path))
    expect(original).toBeDefined()
    const decoded = JSON.parse(Buffer.from(original ?? []).toString('utf8')) as {
      candidate: { releaseSha: string }
    }
    decoded.candidate.releaseSha = 'b'.repeat(40)
    const changed = Buffer.from(canonicalReleaseEvidence(decoded))
    fixture.files.set(String(reference?.path), changed)
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.deployed_critical_journeys'
        ? {
            ...entry,
            evidence: [
              {
                ...entry.evidence[0],
                sha256: gateFEvidenceSha256(changed),
              },
            ],
          }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'candidate.releaseSha: does not match the Gate F release target',
      )
    }
  })

  it('rejects an unretained dependency named by typed promotion evidence', () => {
    const fixture = gateFFixture()
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.restore_rollback'
        ? { ...entry, evidence: entry.evidence.slice(0, -1) }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('is not retained by this gate')
    }
  })
})

describe('Gate F legal revision set', () => {
  // LEG-01 closes the fail-open: until now `release.legalRevisionSet` accepted
  // any bytes at all, so "no external beta before counsel approval" could be
  // satisfied by a file containing two dates.
  const errorsOf = (result: ReturnType<typeof validateFixture>): string => {
    expect(result.ok).toBe(false)
    return result.ok ? '' : result.errors.join('\n')
  }

  it('rejects a revision set that lists a draft document', () => {
    const candidate = fixtureCandidate()
    const base = legalRevisionSetFixture(candidate, LEGAL_CONTEXT)
    const drafted = canonicalLegalRevisionSetEvidence({
      ...base,
      documents: base.documents.map((document) =>
        document.id === 'privacy-notice'
          ? { ...document, status: 'draft' as const }
          : document,
      ),
    })

    expect(errorsOf(validateFixture(gateFFixture(drafted)))).toContain(
      'release.legalRevisionSet: document privacy-notice is a draft and cannot appear in a release legal revision set',
    )
  })

  it('rejects a revision set captured for a different release candidate', () => {
    const other = fixtureCandidate({ releaseSha: 'b'.repeat(40) })
    const foreign = legalRevisionSetFixtureContent(other, LEGAL_CONTEXT)

    expect(errorsOf(validateFixture(gateFFixture(foreign)))).toContain(
      'release.legalRevisionSet: candidate.releaseSha: does not match the Gate F release target',
    )
  })

  it('rejects revision-set bytes that are not canonical JSON', () => {
    const candidate = fixtureCandidate()
    const canonical = legalRevisionSetFixtureContent(candidate, LEGAL_CONTEXT)
    const reindented = `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`

    expect(errorsOf(validateFixture(gateFFixture(reindented)))).toContain(
      'release.legalRevisionSet: Legal revision set must use canonical JSON encoding',
    )
  })

  it('still requires counsel and founder to bind the revision-set digest', () => {
    // Both layers hold: the typed artifact AND the approval binding. Neither
    // one alone would stop an approval signed over a different document set.
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'founder'
        ? { ...approval, legalRevisionSetSha256: digest('f') }
        : approval,
    ) as GateFEvidence['approvals']
    const result = parseGateFEvidence(
      canonicalGateFEvidence({ ...fixture.evidence, approvals }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'counsel and founder must bind the legal revision-set digest',
      )
    }
  })

  it('leaves references outside the typed labels untouched', () => {
    // The new branch is scoped: an unknown label still contributes no typed
    // errors, so ordinary attachments stay ordinary bytes.
    const fixture = gateFFixture()
    const payload = Buffer.from('{"not":"typed release evidence"}\n')
    fixture.files.set('release/promotion-manifest.sigstore.json', payload)
    const release = {
      ...fixture.evidence.release,
      signatureBundle: {
        ...fixture.evidence.release.signatureBundle,
        sha256: gateFEvidenceSha256(payload),
      },
    }
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, release }),
      fixture,
    )

    expect(result.ok).toBe(true)
  })

  it('fails against the shipped registry, where counsel has approved nothing', () => {
    // The default context is the real `docs/legal/legal-document-registry.json`.
    // This is the executable form of the launch blocker: today no Gate F
    // bundle can validate, whatever bytes are placed at this reference.
    const fixture = gateFFixture()
    const result = validateGateFEvidenceBundle(fixture.content, readFixture(fixture))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('release.legalRevisionSet:')
    }
  })
})
