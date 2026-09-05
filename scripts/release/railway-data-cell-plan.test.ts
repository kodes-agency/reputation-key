import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
} from '../../src/shared/release/railway-deployment-profile'
import { parseRailwayPlanEvidence } from '../../src/shared/release/railway-plan-evidence'
import {
  assertRailwayFullCandidatePlanReviewable,
  assertRailwayDataCellTarget,
  assertRailwayTargetMatchesPlanEvidence,
  buildRailwayPlanEvidenceFiles,
  parseRailwayLinkedTarget,
  railwayTargetEnvironment,
  runRailwayDataCellPlanCli,
} from './railway-data-cell-plan'
import {
  RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  RAILWAY_SOURCE_MANAGED_SERVICES,
  type RailwayServiceSourceInput,
} from '../../.railway/service-source-map'

describe('Railway Data Cell plan target', () => {
  it('requires full-project credential visibility in every topology-mutating controller', () => {
    for (const path of [
      'scripts/release/railway-data-cell-plan.ts',
      'scripts/release/bootstrap-schema-migrator.ts',
      'scripts/release/railway-data-cell-foundation.ts',
      'scripts/release/railway-data-cell-domain.ts',
    ]) {
      expect(readFileSync(resolve(path), 'utf8')).toContain(
        'assertRailwayFullProjectVisibilityCredential(',
      )
    }
  })

  it('accepts only the exact linked environment for the requested Data Cell', () => {
    expect(
      assertRailwayDataCellTarget('us', 'production', {
        project: 'project-id',
        name: PRODUCTION_RAILWAY_PROJECT_NAME,
        environment: 'environment-id',
        environmentName: 'cell-us',
      }),
    ).toEqual({
      cell: 'us',
      deploymentProfile: 'production',
      environment: 'cell-us',
      environmentId: 'environment-id',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: 'project-id',
    })
  })

  it('parses the non-secret target identity from Railway status', () => {
    expect(
      parseRailwayLinkedTarget(`
Project:         ${PRODUCTION_RAILWAY_PROJECT_NAME}
Project ID:      project-id

Environment:     cell-us
Environment ID:  environment-id
`),
    ).toEqual({
      project: 'project-id',
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
      environment: 'environment-id',
      environmentName: 'cell-us',
    })
  })

  it('pins planning to opaque project and environment IDs after status', () => {
    expect(
      railwayTargetEnvironment(
        {
          project: 'project-id',
          name: PRODUCTION_RAILWAY_PROJECT_NAME,
          environment: 'environment-id',
        },
        { PATH: '/bin', RAILWAY_PROJECT_ID: 'stale-project' },
      ),
    ).toEqual({
      PATH: '/bin',
      RAILWAY_PROJECT_ID: 'project-id',
      RAILWAY_ENVIRONMENT_ID: 'environment-id',
      REPKEY_RAILWAY_PROJECT_NAME: PRODUCTION_RAILWAY_PROJECT_NAME,
    })
  })

  it('refuses a plausible plan when the repository is linked to another cell', () => {
    expect(() =>
      assertRailwayDataCellTarget('us', 'production', {
        project: 'project-id',
        name: PRODUCTION_RAILWAY_PROJECT_NAME,
        environment: 'environment-id',
        environmentName: 'cell-europe',
      }),
    ).toThrow(
      'Railway Data Cell environment mismatch: expected cell-us, linked cell-europe',
    )
  })

  it('refuses a linked project with the expected environment name', () => {
    expect(() =>
      assertRailwayDataCellTarget('us', 'production', {
        project: 'other-project-id',
        name: 'lookalike-project',
        environment: 'environment-id',
        environmentName: 'cell-us',
      }),
    ).toThrow('Railway project mismatch')
  })

  it('allows a separately named rehearsal project and refuses the production project', () => {
    expect(
      assertRailwayDataCellTarget('us', 'rehearsal', {
        project: 'rehearsal-project-id',
        name: REHEARSAL_RAILWAY_PROJECT_NAME,
        environment: 'rehearsal-environment-id',
        environmentName: 'cell-us',
      }),
    ).toMatchObject({
      deploymentProfile: 'rehearsal',
      projectName: REHEARSAL_RAILWAY_PROJECT_NAME,
      projectId: 'rehearsal-project-id',
    })
    expect(() =>
      assertRailwayDataCellTarget('us', 'rehearsal', {
        project: 'production-project-id',
        name: PRODUCTION_RAILWAY_PROJECT_NAME,
        environment: 'environment-id',
        environmentName: 'cell-us',
      }),
    ).toThrow('Railway project mismatch for rehearsal')
  })

  it.each(['europe', 'global'])(
    'refuses dormant future cell %s before invoking Railway',
    (cell) => {
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      try {
        expect(runRailwayDataCellPlanCli(['--cell', cell])).toBe(1)
        expect(stderr.mock.calls.flat().join('')).toContain('--cell must be one of us')
      } finally {
        stderr.mockRestore()
      }
    },
  )

  it('requires the deployment profile before invoking Railway', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runRailwayDataCellPlanCli(['--cell', 'us'])).toBe(1)
      expect(stderr.mock.calls.flat().join('')).toContain(
        'deployment profile must be one of production, rehearsal',
      )
    } finally {
      stderr.mockRestore()
    }
  })

  it('requires the exact release manifest before invoking Railway', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(
        runRailwayDataCellPlanCli(['--cell', 'us', '--deployment-profile', 'production']),
      ).toBe(1)
      expect(stderr.mock.calls.flat().join('')).toContain(
        '--manifest and --manifest-sha256 are required',
      )
    } finally {
      stderr.mockRestore()
    }
  })
})

describe('Railway Data Cell plan evidence files', () => {
  const input = {
    outputPath: '/evidence/cell-us-plan.json',
    capturedAt: new Date('2026-08-27T09:00:00.000Z'),
    cell: 'us',
    deploymentProfile: 'production',
    target: {
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: 'project-id',
      environment: 'cell-us',
      environmentId: 'environment-id',
    },
    iacSha256: 'b'.repeat(64),
    releaseManifestSha256: 'c'.repeat(64),
    releaseControllerSha256: 'd'.repeat(64),
    exitCode: 2,
    rawPlan: JSON.stringify({
      changes: [{ action: 'update', name: 'web', value: 'postgres://u:pw@host/db' }],
    }),
  } as const

  it('emits parseable canonical evidence beside a shasum-compatible sidecar', () => {
    const files = buildRailwayPlanEvidenceFiles(input)
    const parsed = parseRailwayPlanEvidence(files.content)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.evidence.plan.outcome).toBe('pending-changes')
    expect(parsed.evidence.release.manifestSha256).toBe('c'.repeat(64))
    expect(parsed.evidence.release.controllerSha256).toBe('d'.repeat(64))
    expect(parsed.digest).toBe(files.digest)
    expect(files.sidecarPath).toBe('/evidence/cell-us-plan.json.sha256')
    expect(files.sidecarContent).toBe(`${files.digest}  cell-us-plan.json\n`)
  })

  it('never writes a plan value in plaintext', () => {
    const files = buildRailwayPlanEvidenceFiles(input)

    expect(files.content).not.toContain('postgres://u:pw@host/db')
    expect(files.content).not.toContain('pw')
    expect(files.content).toContain('"name":"web"')
  })

  it('refuses to render evidence for a plan exit that blocks promotion', () => {
    expect(() => buildRailwayPlanEvidenceFiles({ ...input, exitCode: 1 })).toThrow(
      'Railway plan exit 1 blocks promotion',
    )
  })

  it('binds promotion to all four reviewed target identity fields', () => {
    const parsed = parseRailwayPlanEvidence(
      buildRailwayPlanEvidenceFiles({ ...input, exitCode: 0 }).content,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const exactTarget = {
      project: 'project-id',
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
      environment: 'environment-id',
      environmentName: 'cell-us',
    }
    expect(() =>
      assertRailwayTargetMatchesPlanEvidence(parsed.evidence, exactTarget),
    ).not.toThrow()
    expect(() =>
      assertRailwayTargetMatchesPlanEvidence(parsed.evidence, {
        ...exactTarget,
        project: 'lookalike-project-id',
      }),
    ).toThrow('Railway target mismatch for project ID')
    expect(() =>
      assertRailwayTargetMatchesPlanEvidence(parsed.evidence, {
        ...exactTarget,
        environment: 'lookalike-environment-id',
      }),
    ).toThrow('Railway target mismatch for environment ID')
  })
})

describe('Railway full-candidate plan review', () => {
  const target = {
    projectId: 'project-id',
    projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    environmentId: 'environment-id',
    environment: 'cell-us',
  }
  const candidate = {
    version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
    stage: 'promotion',
    sources: Object.fromEntries(
      RAILWAY_SOURCE_MANAGED_SERVICES.map((serviceName, index) => [
        serviceName,
        `ghcr.io/reputation-key/${serviceName}@sha256:${String(index + 1).repeat(64)}`,
      ]),
    ),
  } as RailwayServiceSourceInput

  function convergedPlan(projectName: string = target.projectName): string {
    const resources = RAILWAY_SOURCE_MANAGED_SERVICES.map((serviceName) => ({
      address: `service.${serviceName}`,
      type: 'service',
      name: serviceName,
      source: { type: 'image', image: candidate.sources[serviceName] },
    }))
    return JSON.stringify({
      ok: true,
      currentEnvironment: {
        ...target,
        projectName,
        environmentName: target.environment,
      },
      diagnostics: [],
      changeSet: { changes: [] },
      currentGraph: { resources },
      desiredGraph: { resources },
    })
  }

  it('accepts an exact no-drift candidate and rejects contradictory exit status', () => {
    expect(
      assertRailwayFullCandidatePlanReviewable(convergedPlan(), 0, target, candidate),
    ).toMatchObject({ changeCount: 0 })
    expect(() =>
      assertRailwayFullCandidatePlanReviewable(convergedPlan(), 2, target, candidate),
    ).toThrow('pending plan did not report a graph change')
  })

  it('refuses raw plan evidence for a different project', () => {
    expect(() =>
      assertRailwayFullCandidatePlanReviewable(
        convergedPlan('lookalike-project'),
        0,
        target,
        candidate,
      ),
    ).toThrow('does not match reviewed')
  })
})
