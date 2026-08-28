import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
} from './railway-deployment-profile'
import {
  assertRailwayPlanEvidenceFresh,
  RAILWAY_PLAN_EVIDENCE_MAX_AGE_MS,
  RAILWAY_PLAN_EVIDENCE_VERSION,
  canonicalRailwayPlanEvidence,
  classifyRailwayPlanExit,
  createRailwayPlanEvidence,
  parseRailwayPlanEvidence,
  railwayPlanArgs,
  railwayPlanValueFingerprint,
  redactRailwayPlan,
} from './railway-plan-evidence'

const IAC_SHA256 = 'a'.repeat(64)
const MANIFEST_SHA256 = 'b'.repeat(64)
const CONTROLLER_SHA256 = 'c'.repeat(64)
const CAPTURED_AT = new Date('2026-08-27T09:00:00.000Z')
const TARGET = {
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  projectId: 'project-id',
  environment: 'cell-us',
  environmentId: 'environment-id',
} as const

describe('Railway plan argv', () => {
  it('plans against the repository graph with the documented exit and format flags', () => {
    expect(railwayPlanArgs({ iacFile: '.railway/railway.ts' })).toEqual([
      'config',
      'plan',
      '--file',
      '.railway/railway.ts',
      '--detailed-exit-code',
      '--json',
    ])
  })

  it('refuses --show-values because it would defeat redaction at the source', () => {
    expect(() =>
      railwayPlanArgs({ iacFile: '.railway/railway.ts', extraArgs: ['--show-values'] }),
    ).toThrow('--show-values must never be used for plan evidence')
  })

  it('refuses a --show-values assignment form', () => {
    expect(() =>
      railwayPlanArgs({
        iacFile: '.railway/railway.ts',
        extraArgs: ['--show-values=true'],
      }),
    ).toThrow('--show-values must never be used for plan evidence')
  })
})

describe('Railway plan exit classification', () => {
  it('maps the two documented reviewable outcomes', () => {
    expect(classifyRailwayPlanExit(0)).toBe('no-drift')
    expect(classifyRailwayPlanExit(2)).toBe('pending-changes')
  })

  it('refuses to classify a blocking exit as a reviewable outcome', () => {
    expect(() => classifyRailwayPlanExit(1)).toThrow(
      'Railway plan exit 1 blocks promotion',
    )
  })
})

describe('Railway plan evidence freshness', () => {
  it('accepts the exact review window boundary and rejects stale or future evidence', () => {
    const evidence = { capturedAt: CAPTURED_AT.toISOString() }
    expect(() =>
      assertRailwayPlanEvidenceFresh(
        evidence,
        new Date(CAPTURED_AT.getTime() + RAILWAY_PLAN_EVIDENCE_MAX_AGE_MS),
      ),
    ).not.toThrow()
    expect(() =>
      assertRailwayPlanEvidenceFresh(
        evidence,
        new Date(CAPTURED_AT.getTime() + RAILWAY_PLAN_EVIDENCE_MAX_AGE_MS + 1),
      ),
    ).toThrow('Railway plan evidence is stale')
    expect(() =>
      assertRailwayPlanEvidenceFresh(evidence, new Date(CAPTURED_AT.getTime() - 1)),
    ).toThrow('capturedAt is in the future')
  })
})

describe('Railway plan redaction', () => {
  it('keeps structural placement fields readable for review', () => {
    expect(
      redactRailwayPlan({
        action: 'update',
        domain: 'us.reputationkey.app',
        name: 'web',
        region: 'us-west2',
        replicas: 2,
        destructive: false,
      }),
    ).toEqual({
      action: 'update',
      domain: 'us.reputationkey.app',
      name: 'web',
      region: 'us-west2',
      replicas: 2,
      destructive: false,
    })
  })

  it('fingerprints every string under a non-structural key', () => {
    const redacted = redactRailwayPlan({
      name: 'worker',
      value: 'postgres://user:secret@host/db',
    }) as Record<string, string>

    expect(redacted.name).toBe('worker')
    expect(redacted.value).toBe(
      railwayPlanValueFingerprint('postgres://user:secret@host/db'),
    )
    expect(redacted.value).not.toContain('secret')
  })

  it('fingerprints an unknown value-bearing key by default rather than leaking it', () => {
    const redacted = redactRailwayPlan({
      newlyAddedByRailway: 'sk-live-abc123',
    }) as Record<string, string>

    expect(redacted.newlyAddedByRailway).toBe(
      railwayPlanValueFingerprint('sk-live-abc123'),
    )
    expect(JSON.stringify(redacted)).not.toContain('sk-live-abc123')
  })

  it('redacts array elements using their parent key', () => {
    expect(redactRailwayPlan({ region: ['us-west2'], secrets: ['token-value'] })).toEqual(
      {
        region: ['us-west2'],
        secrets: [railwayPlanValueFingerprint('token-value')],
      },
    )
  })

  it('gives equal fingerprints to unchanged values and different ones to changes', () => {
    expect(railwayPlanValueFingerprint('same')).toBe(railwayPlanValueFingerprint('same'))
    expect(railwayPlanValueFingerprint('before')).not.toBe(
      railwayPlanValueFingerprint('after'),
    )
  })
})

describe('Railway plan evidence record', () => {
  const rawPlan = JSON.stringify({
    changes: [{ action: 'update', name: 'web', value: 'https://internal.example' }],
  })

  it('records the redacted plan, the raw digest, and the matching outcome', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 2,
      rawPlan,
    })

    expect(evidence.version).toBe(RAILWAY_PLAN_EVIDENCE_VERSION)
    expect(evidence.plan.outcome).toBe('pending-changes')
    expect(evidence.plan.rawSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(evidence.target.environment).toBe('cell-us')
    expect(evidence.target.projectName).toBe(PRODUCTION_RAILWAY_PROJECT_NAME)
    expect(evidence.deploymentProfile).toBe('production')
    expect(evidence.release.manifestSha256).toBe(MANIFEST_SHA256)
    expect(evidence.release.controllerSha256).toBe(CONTROLLER_SHA256)
    expect(JSON.stringify(evidence.plan.redacted)).not.toContain('internal.example')
  })

  it('rejects legacy evidence that is not bound to a release manifest', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })
    const { release: _release, ...legacyEvidence } = evidence
    const parsed = parseRailwayPlanEvidence(`${JSON.stringify(legacyEvidence)}\n`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('release')
  })

  it('records a rehearsal only for a separately named project', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'rehearsal',
      target: { ...TARGET, projectName: REHEARSAL_RAILWAY_PROJECT_NAME },
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })

    expect(evidence.deploymentProfile).toBe('rehearsal')
    expect(evidence.target.projectName).toBe(REHEARSAL_RAILWAY_PROJECT_NAME)
    expect(() =>
      createRailwayPlanEvidence({
        capturedAt: CAPTURED_AT,
        cell: 'us',
        deploymentProfile: 'rehearsal',
        target: TARGET,
        iacSha256: IAC_SHA256,
        releaseManifestSha256: MANIFEST_SHA256,
        releaseControllerSha256: CONTROLLER_SHA256,
        exitCode: 0,
        rawPlan,
      }),
    ).toThrow(`rehearsal evidence must name project ${REHEARSAL_RAILWAY_PROJECT_NAME}`)
  })

  it('refuses plan output that is not JSON', () => {
    expect(() =>
      createRailwayPlanEvidence({
        capturedAt: CAPTURED_AT,
        cell: 'us',
        deploymentProfile: 'production',
        target: TARGET,
        iacSha256: IAC_SHA256,
        releaseManifestSha256: MANIFEST_SHA256,
        releaseControllerSha256: CONTROLLER_SHA256,
        exitCode: 0,
        rawPlan: 'Plan: 3 to add, 1 to change.',
      }),
    ).toThrow('Railway plan output is not valid JSON')
  })

  it('refuses to record a blocking exit code as evidence', () => {
    expect(() =>
      createRailwayPlanEvidence({
        capturedAt: CAPTURED_AT,
        cell: 'us',
        deploymentProfile: 'production',
        target: TARGET,
        iacSha256: IAC_SHA256,
        releaseManifestSha256: MANIFEST_SHA256,
        releaseControllerSha256: CONTROLLER_SHA256,
        exitCode: 1,
        rawPlan,
      }),
    ).toThrow('Railway plan exit 1 blocks promotion')
  })

  it('round-trips through canonical encoding', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })
    const content = canonicalRailwayPlanEvidence(evidence)
    const parsed = parseRailwayPlanEvidence(content)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.evidence).toEqual(evidence)
    expect(parsed.digest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects non-canonical encoding so evidence digests stay stable', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })
    const parsed = parseRailwayPlanEvidence(`${JSON.stringify(evidence, null, 2)}\n`)

    expect(parsed).toEqual({
      ok: false,
      errors: ['railway plan evidence must use canonical JSON encoding'],
    })
  })

  it('rejects a record whose outcome contradicts its exit code', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })
    const tampered = canonicalRailwayPlanEvidence({
      ...evidence,
      plan: { ...evidence.plan, outcome: 'pending-changes' },
    })
    const parsed = parseRailwayPlanEvidence(tampered)

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toEqual([
      'plan.outcome: outcome pending-changes does not match exit code 0',
    ])
  })

  it('rejects evidence captured for a dormant future cell', () => {
    const evidence = createRailwayPlanEvidence({
      capturedAt: CAPTURED_AT,
      cell: 'us',
      deploymentProfile: 'production',
      target: TARGET,
      iacSha256: IAC_SHA256,
      releaseManifestSha256: MANIFEST_SHA256,
      releaseControllerSha256: CONTROLLER_SHA256,
      exitCode: 0,
      rawPlan,
    })
    const parsed = parseRailwayPlanEvidence(
      `${JSON.stringify({
        ...evidence,
        cell: 'europe',
        target: { ...evidence.target, environment: 'cell-europe' },
      })}\n`,
    )

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('cell')
  })
})
