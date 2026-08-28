import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertDataCellCutoverTargetMatchesRailwayPlan,
  assertHealthOriginAttached,
  bindRailwayCommandArgsToTarget,
  dataCellCutoverEvidenceFailures,
  deployTimeoutMilliseconds,
  deployPlan,
  parseRailwayDomainHostnames,
  resolveDeploymentAppUrl,
  rebindPromotionManifestAtDigest,
  runDeployBetaCli,
  selectPromotedDeploymentRow,
  validateDataCellCutoverEvidenceForPromotion,
  validateRailwayPlanEvidenceForPromotion,
} from '../../../scripts/release/deploy-beta'
import type { CompletedDataCellCutover } from '#/shared/db/single-us-data-cell-cutover'
import {
  canonicalDataCellCutoverEvidence,
  createDataCellCutoverEvidence,
  dataCellCutoverEvidenceSha256,
} from './data-cell-cutover-evidence'
import {
  createRailwayPlanEvidence,
  RAILWAY_PLAN_EVIDENCE_MAX_AGE_MS,
} from './railway-plan-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTED_IMAGE_REPOSITORIES,
  PROMOTION_MANIFEST_VERSION,
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotedImageReference,
  promotionManifestSha256,
  sigstoreManifestVerificationArgs,
  TRUSTED_RELEASE_REPOSITORY,
  TRUSTED_RELEASE_WORKFLOW_IDENTITY,
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

const digest = (value: string): string => value.repeat(64).slice(0, 64)
const imageDigest = (value: string): `sha256:${string}` => `sha256:${digest(value)}`

function manifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-25T08:00:00.000Z',
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
      imageMetadataIndexSha256: digest('d'),
    },
    contract: {
      lockfileSha256: digest('1'),
      iacSha256: digest('2'),
      releaseControllerSha256: digest('c'),
      migrationHead: '0089_data-cell-assignment',
      capabilityPolicyVersion: 'beta-local-2',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: digest('3'),
      testEvidenceSha256: digest('4'),
      providerApprovalEvidenceSha256: digest('5'),
      sbomIndexSha256: digest('6'),
      vulnerabilityIndexSha256: digest('7'),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
          digest: imageDigest(String((index % 8) + 1)),
          sourceRevision: releaseSha,
          sbomSha256: digest('8'),
          provenanceSha256: digest('9'),
          signatureBundleSha256: digest('a'),
          vulnerabilityReportSha256: digest('b'),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

describe('promotion manifest', () => {
  it('accepts only canonical manifests and derives their immutable digest', () => {
    const content = canonicalPromotionManifest(manifest())
    const parsed = parsePromotionManifest(content)

    expect(parsed).toMatchObject({
      ok: true,
      digest: promotionManifestSha256(content),
    })
  })

  it('rejects the retired three-cell beta release shape', () => {
    const candidate = manifest() as unknown as Record<string, unknown>
    candidate.cells = ['us', 'europe', 'global']
    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('cells')
  })

  it('rejects a well-formed digest from a registry repository the workflow does not own', () => {
    const candidate = manifest()
    candidate.images.web.repository = 'ghcr.io/other-owner/repkey-web'
    const parsed = parsePromotionManifest(canonicalPromotionManifest(candidate))

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        'images.web.repository: image repository must be ghcr.io/kodes-agency/repkey-web',
      )
    }
  })

  it('rejects a manifest signed against an older allocation policy', () => {
    const candidate = manifest() as unknown as {
      contract: { dataCellCataloguePolicyVersion: number }
    }
    candidate.contract.dataCellCataloguePolicyVersion = 2
    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok)
      expect(parsed.errors.join('\n')).toContain(
        'contract.dataCellCataloguePolicyVersion',
      )
  })

  it('refuses a dormant future cell before reading release artifacts', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = await runDeployBetaCli([
        '--manifest',
        '/tmp/manifest.json',
        '--signature-bundle',
        '/tmp/manifest.sigstore.json',
        '--manifest-sha256',
        digest('c'),
        '--people-cutover-evidence',
        '/tmp/people.json',
        '--cell',
        'europe',
      ])
      expect(code).toBe(2)
      expect(stderr.mock.calls.flat().join('')).toContain('--cell must be one of: us')
    } finally {
      stderr.mockRestore()
    }
  })

  it('rejects a mixed-revision image set', () => {
    const candidate = manifest()
    const content = canonicalPromotionManifest({
      ...candidate,
      images: {
        ...candidate.images,
        worker: { ...candidate.images.worker, sourceRevision: 'c'.repeat(40) },
      },
    })

    const parsed = parsePromotionManifest(content)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok)
      expect(parsed.errors.join('\n')).toContain('images.worker.sourceRevision')
  })

  it('rejects a retry-to-green release workflow attempt', () => {
    const candidate = manifest() as unknown as { ci: { runAttempt: number } }
    candidate.ci.runAttempt = 2

    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('ci.runAttempt')
  })

  it('rejects a manifest that claims an unapproved release builder version', () => {
    const candidate = manifest() as unknown as {
      build: { buildxVersion: string }
    }
    candidate.build.buildxVersion = '0.33.0'

    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('build.buildxVersion')
  })

  it('rejects non-canonical JSON even when its values are valid', () => {
    const content = `${JSON.stringify(manifest(), null, 2)}\n`
    expect(parsePromotionManifest(content)).toEqual({
      ok: false,
      errors: ['promotion manifest must use canonical JSON encoding'],
    })
  })

  it('maps Railway services to digest-pinned registry references', () => {
    expect(promotedImageReference(manifest(), 'google-egress-gateway')).toBe(
      `${PROMOTED_IMAGE_REPOSITORIES.googleEgressGateway}@${imageDigest('5')}`,
    )
  })

  it('builds one exact-image plan for every Railway runtime service', () => {
    const candidate = manifest()
    const manifestDigest = digest('c')
    const plan = deployPlan(candidate, manifestDigest)

    expect(plan.map((entry) => entry.service)).toEqual([
      'google-provider-redis',
      'web',
      'worker',
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ])
    expect(plan).toHaveLength(7)
    for (const entry of plan) {
      expect(entry.imageReference.endsWith(`@${entry.imageDigest}`)).toBe(true)
      expect(entry.variables).toEqual([
        `RELEASE_SHA=${candidate.releaseSha}`,
        `RELEASE_MANIFEST_SHA256=${manifestDigest}`,
      ])
    }
  })

  it('bounds deployment settlement time to a safe whole-hour maximum', () => {
    expect(deployTimeoutMilliseconds(undefined)).toBe(900_000)
    expect(deployTimeoutMilliseconds('3600')).toBe(3_600_000)
    for (const invalid of ['0', '-1', '1.5', '3601', 'Infinity']) {
      expect(() => deployTimeoutMilliseconds(invalid)).toThrow(
        '--deploy-timeout must be a positive integer no greater than 3600 seconds',
      )
    }
  })

  it('rebinds the runtime manifest to the exact digest verified by the operator', () => {
    const content = canonicalPromotionManifest(manifest())
    const expectedDigest = promotionManifestSha256(content)

    expect(rebindPromotionManifestAtDigest(content, expectedDigest)).toEqual(manifest())
    expect(() => rebindPromotionManifestAtDigest(content, digest('f'))).toThrow(
      'verified promotion manifest digest',
    )
  })

  it('uses pinned IaC plans without uploads or project-wide source-connect mutations', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/deploy-beta.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/railway(?:\(\[|\s+)['"]?up\b/u)
    expect(source).not.toMatch(/['"]source['"],\s*['"]connect['"]/u)
    expect(source).toContain('railwayPinnedPlanArgs(')
    expect(source).toContain('railwayPinnedApplyArgs(')
  })

  it('requires people cutover evidence as part of every promotion plan', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = await runDeployBetaCli([
        '--manifest',
        '/tmp/manifest.json',
        '--signature-bundle',
        '/tmp/manifest.sigstore.json',
        '--manifest-sha256',
        digest('c'),
        '--cell',
        'us',
      ])
      expect(code).toBe(2)
      expect(stderr.mock.calls.flat().join('')).toContain('--people-cutover-evidence')
    } finally {
      stderr.mockRestore()
    }
  })

  it('requires immutable Railway plan evidence as part of every promotion plan', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = await runDeployBetaCli([
        '--manifest',
        '/tmp/manifest.json',
        '--signature-bundle',
        '/tmp/manifest.sigstore.json',
        '--manifest-sha256',
        digest('c'),
        '--people-cutover-evidence',
        '/tmp/people.json',
        '--cell',
        'us',
      ])
      expect(code).toBe(2)
      expect(stderr.mock.calls.flat().join('')).toContain('--railway-plan-evidence')
      expect(stderr.mock.calls.flat().join('')).toContain(
        '--railway-plan-evidence-sha256',
      )
    } finally {
      stderr.mockRestore()
    }
  })

  it('requires digest-pinned Data Cell cutover evidence', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const missing = await runDeployBetaCli([
        '--manifest',
        '/tmp/manifest.json',
        '--signature-bundle',
        '/tmp/manifest.sigstore.json',
        '--manifest-sha256',
        digest('c'),
        '--people-cutover-evidence',
        '/tmp/people.json',
        '--railway-plan-evidence',
        '/tmp/railway-plan.json',
        '--railway-plan-evidence-sha256',
        digest('d'),
        '--cell',
        'us',
      ])
      expect(missing).toBe(2)
      expect(stderr.mock.calls.flat().join('')).toContain('--data-cell-cutover-evidence')

      stderr.mockClear()
      const malformedDigest = await runDeployBetaCli([
        '--manifest',
        '/tmp/manifest.json',
        '--signature-bundle',
        '/tmp/manifest.sigstore.json',
        '--manifest-sha256',
        digest('c'),
        '--people-cutover-evidence',
        '/tmp/people.json',
        '--data-cell-cutover-evidence',
        '/tmp/data-cell.json',
        '--data-cell-cutover-evidence-sha256',
        'NOT-A-DIGEST',
        '--railway-plan-evidence',
        '/tmp/railway-plan.json',
        '--railway-plan-evidence-sha256',
        digest('d'),
        '--cell',
        'us',
      ])
      expect(malformedDigest).toBe(2)
      expect(stderr.mock.calls.flat().join('')).toContain(
        '--data-cell-cutover-evidence-sha256 must be a lowercase sha256',
      )
    } finally {
      stderr.mockRestore()
    }
  })

  it('binds Data Cell evidence to the exact live completed control row', () => {
    const completedAt = new Date('2026-08-27T10:00:00.000Z')
    const evidence = createDataCellCutoverEvidence({
      capturedAt: new Date('2026-08-27T10:01:00.000Z'),
      completedAt,
      reportDigestSha256: digest('c'),
      completionDigestSha256: digest('d'),
      propertiesProcessed: 12,
      credentialHomesProcessed: 4,
      credentialConnectionsProcessed: 9,
      errorCount: 0,
      verification: {
        remainingProperties: 0,
        resolvablePropertiesRemaining: 0,
        remainingCredentialHomes: 0,
        activeWorkflowBlockers: 2,
        routingConflicts: 0,
      },
      targetProjectId: 'railway-project-us-test',
      targetEnvironmentId: 'railway-environment-us-test',
      operatorId: 'release-operator',
      changeTicket: 'CHG-123',
      correlationId: 'correlation-123',
    })
    const completed: CompletedDataCellCutover = {
      verifiedAt: new Date('2026-08-27T10:02:00.000Z'),
      completedAt,
      reportDigestSha256: digest('c'),
      completionDigestSha256: digest('d'),
      propertiesProcessed: 12,
      credentialHomesProcessed: 4,
      credentialConnectionsProcessed: 9,
      errorCount: 0,
      verification: {
        remainingProperties: 0,
        resolvablePropertiesRemaining: 0,
        remainingCredentialHomes: 0,
        activeWorkflowBlockers: 2,
        routingConflicts: 0,
      },
      targetProjectId: 'railway-project-us-test',
      targetEnvironmentId: 'railway-environment-us-test',
      operatorId: 'release-operator',
      changeTicket: 'CHG-123',
      correlationId: 'correlation-123',
    }

    expect(dataCellCutoverEvidenceFailures(completed, evidence)).toEqual([])
    expect(
      dataCellCutoverEvidenceFailures(
        { ...completed, completionDigestSha256: digest('e') },
        evidence,
      ),
    ).toEqual([
      `Data Cell cutover completionDigestSha256 live=${digest('e')} evidence=${digest('d')}`,
    ])
    expect(
      dataCellCutoverEvidenceFailures(
        {
          ...completed,
          credentialConnectionsProcessed: 10,
          targetProjectId: 'different-project',
          targetEnvironmentId: 'different-environment',
        },
        evidence,
      ),
    ).toEqual([
      'Data Cell cutover credentialConnectionsProcessed live=10 evidence=9',
      'Data Cell cutover target.projectId live=different-project evidence=railway-project-us-test',
      'Data Cell cutover target.environmentId live=different-environment evidence=railway-environment-us-test',
    ])
    expect(
      dataCellCutoverEvidenceFailures(
        {
          ...completed,
          verification: { ...completed.verification, activeWorkflowBlockers: 3 },
        },
        evidence,
      ),
    ).toEqual([])

    const targetPlan = createRailwayPlanEvidence({
      capturedAt: new Date('2026-08-27T10:01:00.000Z'),
      cell: 'us',
      deploymentProfile: 'production',
      target: {
        projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
        projectId: evidence.target.projectId,
        environment: 'cell-us',
        environmentId: evidence.target.environmentId,
      },
      iacSha256: digest('a'),
      releaseManifestSha256: digest('c'),
      releaseControllerSha256: manifest().contract.releaseControllerSha256,
      exitCode: 0,
      rawPlan: JSON.stringify({ changes: [] }),
    })
    expect(() =>
      assertDataCellCutoverTargetMatchesRailwayPlan(evidence, targetPlan),
    ).not.toThrow()
    expect(() =>
      assertDataCellCutoverTargetMatchesRailwayPlan(evidence, {
        ...targetPlan,
        target: { ...targetPlan.target, projectId: 'different-project' },
      }),
    ).toThrow('Data Cell cutover target projectId=railway-project-us-test')

    const content = canonicalDataCellCutoverEvidence(evidence)
    expect(
      validateDataCellCutoverEvidenceForPromotion(
        content,
        dataCellCutoverEvidenceSha256(content),
      ),
    ).toEqual(evidence)
    expect(validateDataCellCutoverEvidenceForPromotion(content, digest('f'))).toContain(
      'does not match --data-cell-cutover-evidence-sha256',
    )
  })

  it('gives production its canonical host and requires a distinct rehearsal URL', () => {
    expect(resolveDeploymentAppUrl({ deploymentProfile: 'production', cell: 'us' })).toBe(
      'https://us.reputationkey.app',
    )
    expect(
      resolveDeploymentAppUrl({
        deploymentProfile: 'production',
        cell: 'us',
        appUrlOverride: 'https://repkey-production-precutover.up.railway.app',
      }),
    ).toBe('https://repkey-production-precutover.up.railway.app')
    expect(() =>
      resolveDeploymentAppUrl({ deploymentProfile: 'rehearsal', cell: 'us' }),
    ).toThrow('requires its own explicit --app-url')
    expect(() =>
      resolveDeploymentAppUrl({
        deploymentProfile: 'rehearsal',
        cell: 'us',
        appUrlOverride: 'https://us.reputationkey.app',
      }),
    ).toThrow('must not use the production host')
    expect(
      resolveDeploymentAppUrl({
        deploymentProfile: 'rehearsal',
        cell: 'us',
        appUrlOverride: 'https://repkey-rehearsal.up.railway.app/',
      }),
    ).toBe('https://repkey-rehearsal.up.railway.app')
  })

  it('binds a fresh reviewable plan to the signed IaC and exact release manifest', () => {
    const candidate = manifest()
    const manifestSha256 = digest('c')
    const planEvidence = createRailwayPlanEvidence({
      capturedAt: new Date('2026-08-27T09:00:00.000Z'),
      cell: 'us',
      deploymentProfile: 'production',
      target: {
        projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
        projectId: 'project-id',
        environment: 'cell-us',
        environmentId: 'environment-id',
      },
      iacSha256: candidate.contract.iacSha256,
      releaseManifestSha256: manifestSha256,
      releaseControllerSha256: candidate.contract.releaseControllerSha256,
      exitCode: 0,
      rawPlan: JSON.stringify({ changes: [] }),
    })
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: candidate.contract.iacSha256,
        currentIacSha256: candidate.contract.iacSha256,
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        now: new Date('2026-08-27T09:30:00.000Z'),
      }),
    ).not.toThrow()
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(
        createRailwayPlanEvidence({
          capturedAt: new Date('2026-08-27T09:00:00.000Z'),
          cell: 'us',
          deploymentProfile: 'production',
          target: planEvidence.target,
          iacSha256: candidate.contract.iacSha256,
          releaseManifestSha256: manifestSha256,
          releaseControllerSha256: candidate.contract.releaseControllerSha256,
          exitCode: 2,
          rawPlan: JSON.stringify({ changes: [{ address: 'service.web' }] }),
        }),
        {
          cell: 'us',
          manifestSha256,
          signedIacSha256: candidate.contract.iacSha256,
          currentIacSha256: candidate.contract.iacSha256,
          signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          now: new Date('2026-08-27T09:30:00.000Z'),
        },
      ),
    ).not.toThrow()
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(
        {
          ...planEvidence,
          release: { ...planEvidence.release, manifestSha256: digest('d') },
        },
        {
          cell: 'us',
          manifestSha256,
          signedIacSha256: candidate.contract.iacSha256,
          currentIacSha256: candidate.contract.iacSha256,
          signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          now: new Date('2026-08-27T09:30:00.000Z'),
        },
      ),
    ).toThrow('does not match requested manifest digest')
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(
        {
          ...planEvidence,
          release: { ...planEvidence.release, controllerSha256: digest('d') },
        },
        {
          cell: 'us',
          manifestSha256,
          signedIacSha256: candidate.contract.iacSha256,
          currentIacSha256: candidate.contract.iacSha256,
          signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
          now: new Date('2026-08-27T09:30:00.000Z'),
        },
      ),
    ).toThrow('Railway plan controller digest')
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: candidate.contract.iacSha256,
        currentIacSha256: candidate.contract.iacSha256,
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: digest('f'),
        now: new Date('2026-08-27T09:30:00.000Z'),
      }),
    ).toThrow('local release-controller digest')
    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: digest('f'),
        currentIacSha256: digest('f'),
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        now: new Date('2026-08-27T09:30:00.000Z'),
      }),
    ).toThrow('does not match signed manifest IaC digest')

    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: candidate.contract.iacSha256,
        currentIacSha256: digest('f'),
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        now: new Date('2026-08-27T09:30:00.000Z'),
      }),
    ).toThrow('current Railway IaC digest')

    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: candidate.contract.iacSha256,
        currentIacSha256: candidate.contract.iacSha256,
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        now: new Date(
          Date.parse(planEvidence.capturedAt) + RAILWAY_PLAN_EVIDENCE_MAX_AGE_MS + 1,
        ),
      }),
    ).toThrow('Railway plan evidence is stale')

    expect(() =>
      validateRailwayPlanEvidenceForPromotion(planEvidence, {
        cell: 'us',
        manifestSha256,
        signedIacSha256: candidate.contract.iacSha256,
        currentIacSha256: candidate.contract.iacSha256,
        signedReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        currentReleaseControllerSha256: candidate.contract.releaseControllerSha256,
        now: new Date('2026-08-27T08:59:59.999Z'),
      }),
    ).toThrow('capturedAt is in the future')
  })

  it('accepts a health origin only from hostname fields in Railway domain output', () => {
    expect(
      parseRailwayDomainHostnames(
        JSON.stringify({
          serviceDomains: [{ domain: 'repkey.up.railway.app.' }],
          customDomains: [{ hostname: 'US.ReputationKey.App' }],
          unrelated: 'attacker.example',
        }),
      ),
    ).toEqual(['repkey.up.railway.app', 'us.reputationkey.app'])
    expect(() => parseRailwayDomainHostnames('{not-json')).toThrow(
      'could not parse Railway web domain list',
    )
    expect(() => parseRailwayDomainHostnames(JSON.stringify({ domains: [] }))).toThrow(
      'did not contain a hostname',
    )
    expect(() =>
      assertHealthOriginAttached('https://repkey-rehearsal.up.railway.app', [
        'repkey-rehearsal.up.railway.app',
      ]),
    ).not.toThrow()
    expect(() =>
      assertHealthOriginAttached('https://repkey-rehearsal.up.railway.app', [
        'us.reputationkey.app',
      ]),
    ).toThrow('is not attached to the reviewed Railway web service')
  })

  it('settles only an unambiguous new deployment carrying the signed digest', () => {
    const oldId = '11111111-1111-4111-8111-111111111111'
    const newId = '22222222-2222-4222-8222-222222222222'
    const deployment = {
      service: 'web',
      deploymentId: undefined,
      baselineDeploymentIds: [oldId],
    }
    expect(
      selectPromotedDeploymentRow(
        [
          {
            id: oldId,
            status: 'SUCCESS',
            meta: { imageDigest: `sha256:${digest('a')}` },
          },
          {
            id: newId,
            status: 'DEPLOYING',
            meta: { imageDigest: `sha256:${digest('a')}` },
          },
        ],
        deployment,
        `sha256:${digest('a')}`,
      ),
    ).toMatchObject({ id: newId, status: 'DEPLOYING' })
    expect(() =>
      selectPromotedDeploymentRow(
        [
          {
            id: newId,
            status: 'DEPLOYING',
            meta: { imageDigest: `sha256:${digest('a')}` },
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            status: 'QUEUED',
            meta: { imageDigest: `sha256:${digest('a')}` },
          },
        ],
        deployment,
        `sha256:${digest('a')}`,
      ),
    ).toThrow('multiple new deployments')
  })

  it('rewrites every Railway target flag to reviewed opaque IDs', () => {
    const target = {
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: 'project-id',
      environment: 'cell-us',
      environmentId: 'environment-id',
    } as const
    expect(
      bindRailwayCommandArgsToTarget(
        [
          'variable',
          'list',
          '--project',
          PRODUCTION_RAILWAY_PROJECT_NAME,
          '--environment',
          'cell-us',
        ],
        target,
      ),
    ).toEqual([
      'variable',
      'list',
      '--project',
      'project-id',
      '--environment',
      'environment-id',
    ])
    expect(() =>
      bindRailwayCommandArgsToTarget(
        ['variable', 'list', '--environment', 'cell-europe'],
        target,
      ),
    ).toThrow('does not match the reviewed Railway target')
  })

  it('checks live people parity before the first Railway mutation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/deploy-beta.ts'),
      'utf8',
    )
    const parityPreflight = source.indexOf(
      "out('preflight: people authority cutover parity + audited evidence')",
    )
    const firstDeployment = source.indexOf('const providerStage = stageServiceSource(')

    expect(parityPreflight).toBeGreaterThan(0)
    expect(firstDeployment).toBeGreaterThan(parityPreflight)
  })

  it('checks the exact reviewed Railway target before entering the mutating harness', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/deploy-beta.ts'),
      'utf8',
    )
    const targetPreflight = source.lastIndexOf(
      'pinAndAssertRailwayTarget(options.railwayPlanEvidence, candidateSources)',
    )
    const livePlanPreflight = source.lastIndexOf('assertLiveRailwayPlanMatchesEvidence(')
    const healthOriginPreflight = source.lastIndexOf(
      'assertHealthOriginBelongsToTarget(options)',
    )
    const harnessImport = source.indexOf(
      "const { runOperatorCommand } = await import('../ops/operator-command')",
    )

    expect(targetPreflight).toBeGreaterThan(0)
    expect(livePlanPreflight).toBeGreaterThan(targetPreflight)
    expect(healthOriginPreflight).toBeGreaterThan(livePlanPreflight)
    expect(harnessImport).toBeGreaterThan(targetPreflight)
  })

  it('binds Data Cell completion to live state before the mutating harness and deployment', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/deploy-beta.ts'),
      'utf8',
    )
    const applyPreflight = source.lastIndexOf(
      'const dataCellCutoverFailures = await verifyDataCellCutover(',
    )
    const harnessImport = source.indexOf(
      "const { runOperatorCommand } = await import('../ops/operator-command')",
    )
    const inHarnessPreflight = source.indexOf(
      "out('preflight: completed single-US Data Cell cutover + retained evidence')",
    )
    const firstDeployment = source.indexOf('const providerStage = stageServiceSource(')

    expect(applyPreflight).toBeGreaterThan(0)
    expect(harnessImport).toBeGreaterThan(applyPreflight)
    expect(inHarnessPreflight).toBeGreaterThan(0)
    expect(firstDeployment).toBeGreaterThan(inHarnessPreflight)
  })

  it('pins keyless verification to the producing workflow identity and issuer', () => {
    expect(
      sigstoreManifestVerificationArgs({
        manifestPath: '/release/manifest.json',
        bundlePath: '/release/manifest.sigstore.json',
      }),
    ).toEqual([
      'verify-blob',
      '--bundle',
      '/release/manifest.sigstore.json',
      '--certificate-identity',
      TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      '/release/manifest.json',
    ])
  })

  it('rejects a manifest that asks the deployer to trust another workflow', () => {
    const candidate = structuredClone(manifest()) as unknown as {
      ci: { workflowIdentity: string }
    }
    candidate.ci.workflowIdentity =
      'https://github.com/attacker/repository/.github/workflows/release-images.yml@refs/heads/main'
    expect(
      parsePromotionManifest(
        canonicalPromotionManifest(candidate as unknown as PromotionManifest),
      ),
    ).toMatchObject({ ok: false })
  })
})
