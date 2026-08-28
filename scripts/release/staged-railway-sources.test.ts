import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPinnedRailwayApplyResult,
  assertRailwayCliSupportsPinnedPlans,
  assertRailwaySavedPlanArtifactUnchanged,
  bindRailwaySavedPlanArtifact,
  fullRailwayServiceSourceInput,
  inspectFullCandidateRailwayPlan,
  inspectStagedRailwayPlan,
  railwayPinnedApplyArgs,
  railwayPinnedPlanArgs,
  railwaySavedPlanSourceTree,
  stagedRailwayServiceSourceInput,
} from './staged-railway-sources'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTED_IMAGE_REPOSITORIES,
  PROMOTION_MANIFEST_VERSION,
  TRUSTED_RELEASE_REPOSITORY,
  TRUSTED_RELEASE_WORKFLOW_IDENTITY,
  type PromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import {
  RELEASE_BUILDKIT_IMAGE,
  RELEASE_BUILDKIT_VERSION,
  RELEASE_BUILDX_VERSION,
  RELEASE_DOCKER_VERSION,
  RELEASE_RUNNER_ARCHITECTURE,
  RELEASE_RUNNER_IMAGE_OS,
  RELEASE_RUNNER_LABEL,
} from '../../src/shared/release/release-build-toolchain'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { SINGLE_US_BETA_RAILWAY_SERVICE_NAMES } from '../../src/shared/release/railway-project-service-isolation'
import { RAILWAY_SOURCE_MANAGED_SERVICES } from '../../.railway/service-source-map'

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

function manifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-27T10:00:00.000Z',
    source: { repository: TRUSTED_RELEASE_REPOSITORY, ref: 'refs/heads/main' },
    ci: {
      workflowIdentity: TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      runId: '1',
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
      imageMetadataIndexSha256: 'e'.repeat(64),
    },
    contract: {
      lockfileSha256: '1'.repeat(64),
      iacSha256: '2'.repeat(64),
      releaseControllerSha256: 'c'.repeat(64),
      migrationHead: '0140_single_us_beta_data_cell',
      capabilityPolicyVersion: 'beta-local-2',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: '3'.repeat(64),
      testEvidenceSha256: '4'.repeat(64),
      providerApprovalEvidenceSha256: '5'.repeat(64),
      sbomIndexSha256: '6'.repeat(64),
      vulnerabilityIndexSha256: '7'.repeat(64),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
          digest: digest(String((index % 8) + 1)),
          sourceRevision: releaseSha,
          sbomSha256: '8'.repeat(64),
          provenanceSha256: '9'.repeat(64),
          signatureBundleSha256: 'a'.repeat(64),
          vulnerabilityReportSha256: 'b'.repeat(64),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

const target = {
  projectId: 'project-id',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: 'environment-id',
  environment: 'cell-us',
}

function planJson(input: {
  currentSources: Readonly<Record<string, string>>
  desiredSources: Readonly<Record<string, string>>
  changes: readonly unknown[]
}): string {
  const services = [
    'schema-migrator',
    'web',
    'worker',
    'google-provider-redis',
    'google-execution-admission',
    'google-egress-gateway',
    'ai-execution-admission',
    'ai-egress-gateway',
  ]
  const graph = (sources: Readonly<Record<string, string>>) => ({
    resources: services.map((service) => ({
      address: `service.${service}`,
      type: 'service',
      name: service,
      ...(sources[service] ? { source: { type: 'image', image: sources[service] } } : {}),
    })),
  })
  return JSON.stringify({
    ok: true,
    currentEnvironment: {
      projectId: target.projectId,
      projectName: target.projectName,
      environmentId: target.environmentId,
      environmentName: target.environment,
    },
    diagnostics: [],
    changeSet: { changes: input.changes },
    currentGraph: graph(input.currentSources),
    desiredGraph: graph(input.desiredSources),
  })
}

function sourceChange(
  serviceName: string,
  beforeImage: string | undefined,
  afterImage: string,
) {
  const details = beforeImage
    ? [`source.image (${JSON.stringify(beforeImage)} → ${JSON.stringify(afterImage)})`]
    : [
        `source.image (null → ${JSON.stringify(afterImage)})`,
        'source.type (null → "image")',
      ]
  return {
    kind: 'resource.update',
    summary: `Update ${serviceName} ${beforeImage ? 'source.image' : 'source.image, source.type'}`,
    severity: 'safe',
    details,
  }
}

function rawSourceChange(
  serviceName: string,
  beforeImage: string | undefined,
  afterImage: string,
) {
  return {
    ...sourceChange(serviceName, beforeImage, afterImage),
    address: `service.${serviceName}`,
    field: 'source',
    before: beforeImage ? { type: 'image', image: beforeImage } : null,
    after: { type: 'image', image: afterImage },
    path: `resources.service.${serviceName}.source`,
    deployEffect: 'deploy',
  }
}

describe('staged Railway source promotion', () => {
  it('keeps the pre-mutation isolation guard aligned with every mutable source', () => {
    expect(SINGLE_US_BETA_RAILWAY_SERVICE_NAMES).toEqual(RAILWAY_SOURCE_MANAGED_SERVICES)
  })

  it('requires the Railway release with saved-plan support', () => {
    expect(() => assertRailwayCliSupportsPinnedPlans('railway 5.43.3')).toThrow(
      '5.45.2 or newer',
    )
    expect(() => assertRailwayCliSupportsPinnedPlans('railway 5.45.2')).not.toThrow()
  })

  it('builds exact schema and serving sources from one signed manifest', () => {
    const sources = fullRailwayServiceSourceInput(manifest()).sources
    expect(Object.keys(sources)).toHaveLength(8)
    expect(sources['schema-migrator']).toBe(sources.web)
    for (const reference of Object.values(sources)) {
      expect(reference).toMatch(/@sha256:[0-9a-f]{64}$/u)
    }
  })

  it('pins the saved plan and apply command shapes', () => {
    expect(railwayPinnedPlanArgs('/private/plan.json')).toEqual([
      'config',
      'plan',
      '--file',
      '.railway/railway.ts',
      '--out',
      '/private/plan.json',
      '--detailed-exit-code',
      '--json',
    ])
    expect(railwayPinnedApplyArgs('/private/plan.json')).toEqual([
      'config',
      'apply',
      '--plan',
      '/private/plan.json',
      '--yes',
      '--json',
    ])
  })

  it('matches Railway saved-plan tree hashing for a dirty .railway directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'repkey-railway-tree-'))
    try {
      mkdirSync(join(root, '.railway', 'nested'), { recursive: true })
      writeFileSync(join(root, '.railway', 'b.ts'), 'second\n')
      writeFileSync(join(root, '.railway', 'nested', 'a.ts'), 'first\n')
      writeFileSync(join(root, '.railway', '.DS_Store'), 'ignored')
      const expected = createHash('sha256')
        .update('b.ts')
        .update(Buffer.from([0]))
        .update('second\n')
        .update(Buffer.from([0]))
        .update('nested/a.ts')
        .update(Buffer.from([0]))
        .update('first\n')
        .update(Buffer.from([0]))
        .digest('hex')

      expect(railwaySavedPlanSourceTree(root)).toBe(`sha256:${expected}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts exactly one staged source update and refuses concurrent drift', () => {
    const candidate = fullRailwayServiceSourceInput(manifest())
    const current = {}
    const staged = stagedRailwayServiceSourceInput(current, candidate, 'schema-migrator')
    const change = sourceChange(
      'schema-migrator',
      undefined,
      staged.sources['schema-migrator'] ?? '',
    )
    expect(
      inspectStagedRailwayPlan(
        planJson({
          currentSources: current,
          desiredSources: staged.sources,
          changes: [change],
        }),
        target,
        current,
        staged,
        'schema-migrator',
      ),
    ).toBe('change')
    expect(() =>
      inspectStagedRailwayPlan(
        planJson({
          currentSources: current,
          desiredSources: staged.sources,
          changes: [change, { kind: 'variable.delete' }],
        }),
        target,
        current,
        staged,
        'schema-migrator',
      ),
    ).toThrow('exactly one source update')
  })

  it('allows retained full-candidate evidence to contain only its exact safe source differences', () => {
    const candidate = fullRailwayServiceSourceInput(manifest())
    const changes = RAILWAY_SOURCE_MANAGED_SERVICES.map((serviceName) =>
      sourceChange(serviceName, undefined, candidate.sources[serviceName] ?? ''),
    )
    expect(
      inspectFullCandidateRailwayPlan(
        planJson({
          currentSources: {},
          desiredSources: candidate.sources,
          changes,
        }),
        target,
        candidate,
      ),
    ).toMatchObject({ changeCount: RAILWAY_SOURCE_MANAGED_SERVICES.length })

    expect(() =>
      inspectFullCandidateRailwayPlan(
        planJson({
          currentSources: {},
          desiredSources: candidate.sources,
          changes: [...changes.slice(1), { kind: 'variable.delete' }],
        }),
        target,
        candidate,
      ),
    ).toThrow('omitted the schema-migrator source update')
  })

  it('accepts only Railway 5.45.2 four-field displayed source changes', () => {
    const candidate = fullRailwayServiceSourceInput(manifest())
    const current = {}
    const staged = stagedRailwayServiceSourceInput(current, candidate, 'schema-migrator')
    const change = sourceChange(
      'schema-migrator',
      undefined,
      staged.sources['schema-migrator'] ?? '',
    )
    const invalidChanges = [
      { ...change, kind: 'resource.create' },
      { ...change, severity: 'destructive' },
      { ...change, summary: 'Update web source.image' },
      { ...change, details: ['deploy.region'] },
      { ...change, unexpected: true },
    ]
    for (const invalid of invalidChanges) {
      expect(() =>
        inspectStagedRailwayPlan(
          planJson({
            currentSources: current,
            desiredSources: staged.sources,
            changes: [invalid],
          }),
          target,
          current,
          staged,
          'schema-migrator',
        ),
      ).toThrow('unexpected schema-migrator change')
    }
  })

  it('binds saved-plan bytes to the inspected change set and detects later edits', () => {
    const candidate = fullRailwayServiceSourceInput(manifest())
    const current = {}
    const staged = stagedRailwayServiceSourceInput(current, candidate, 'schema-migrator')
    const output = planJson({
      currentSources: current,
      desiredSources: staged.sources,
      changes: [
        sourceChange(
          'schema-migrator',
          undefined,
          staged.sources['schema-migrator'] ?? '',
        ),
      ],
    })
    const image = staged.sources['schema-migrator'] ?? ''
    const rawChange = rawSourceChange('schema-migrator', undefined, image)
    const directory = mkdtempSync(join(tmpdir(), 'repkey-saved-plan-test-'))
    const planPath = join(directory, 'saved-plan.json')
    try {
      const savedArtifact = (change: unknown) =>
        JSON.stringify({
          kind: 'railway.config.plan',
          version: 1,
          environmentId: target.environmentId,
          destructive: false,
          changeSet: { changes: [change] },
        })
      const saved = savedArtifact(rawChange)
      writeFileSync(planPath, saved)
      const sha256 = bindRailwaySavedPlanArtifact(
        planPath,
        output,
        target,
        current,
        staged,
        'schema-migrator',
      )
      expect(() =>
        assertRailwaySavedPlanArtifactUnchanged(planPath, sha256),
      ).not.toThrow()

      for (const invalid of [
        { ...rawChange, address: 'service.web' },
        { ...rawChange, field: 'deploy' },
        { ...rawChange, before: {} },
        {
          ...rawChange,
          after: { type: 'image', image: `ghcr.io/wrong/image@sha256:${'f'.repeat(64)}` },
        },
        { ...rawChange, path: 'resources.service.web.source' },
        { ...rawChange, deployEffect: 'none' },
        { ...rawChange, unexpected: true },
      ]) {
        writeFileSync(planPath, savedArtifact(invalid))
        expect(() =>
          bindRailwaySavedPlanArtifact(
            planPath,
            output,
            target,
            current,
            staged,
            'schema-migrator',
          ),
        ).toThrow('unexpected schema-migrator source change')
      }

      writeFileSync(planPath, saved)
      writeFileSync(planPath, `${saved}\n`)
      expect(() => assertRailwaySavedPlanArtifactUnchanged(planPath, sha256)).toThrow(
        'changed between inspection and apply',
      )

      writeFileSync(
        planPath,
        JSON.stringify({
          kind: 'railway.config.plan',
          version: 1,
          environmentId: target.environmentId,
          destructive: false,
          changeSet: { changes: [] },
        }),
      )
      expect(() =>
        bindRailwaySavedPlanArtifact(
          planPath,
          output,
          target,
          current,
          staged,
          'schema-migrator',
        ),
      ).toThrow('does not match the inspected safe plan')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('accepts a fully converged retry only when the plan has no changes', () => {
    const candidate = fullRailwayServiceSourceInput(manifest())
    const current = candidate.sources
    const staged = stagedRailwayServiceSourceInput(current, candidate, 'web')
    expect(
      inspectStagedRailwayPlan(
        planJson({
          currentSources: current,
          desiredSources: staged.sources,
          changes: [],
        }),
        target,
        current,
        staged,
        'web',
      ),
    ).toBe('noop')
  })

  it('requires an applied result for the exact service source path', () => {
    expect(() =>
      assertPinnedRailwayApplyResult(
        JSON.stringify({
          id: 'apply-id',
          status: 'complete',
          diagnostics: [],
          changes: [
            {
              kind: 'resource.update',
              path: 'resources.service.web.source',
              status: 'applied',
            },
          ],
        }),
        'web',
      ),
    ).not.toThrow()
    expect(() =>
      assertPinnedRailwayApplyResult(
        JSON.stringify({ status: 'complete', diagnostics: [], changes: [] }),
        'web',
      ),
    ).toThrow('must report one change')
    expect(() =>
      assertPinnedRailwayApplyResult(
        JSON.stringify({
          status: 'unknown-terminal',
          diagnostics: [],
          changes: [
            {
              kind: 'resource.update',
              path: 'resources.service.web.source',
              status: 'applied',
            },
          ],
        }),
        'web',
      ),
    ).toThrow('ended unknown-terminal')
    expect(() =>
      assertPinnedRailwayApplyResult(
        JSON.stringify({
          status: 'complete',
          diagnostics: [],
          changes: [
            {
              kind: 'resource.update',
              path: 'resources.service.web.source',
              status: 'noop',
            },
          ],
        }),
        'web',
      ),
    ).toThrow('did not confirm')
    expect(() =>
      assertPinnedRailwayApplyResult(
        JSON.stringify({
          status: 'complete',
          diagnostics: [{ severity: 'warning', message: 'unexpected' }],
          changes: [
            {
              kind: 'resource.update',
              path: 'resources.service.web.source',
              status: 'applied',
            },
          ],
        }),
        'web',
      ),
    ).toThrow('reported diagnostics')
  })
})
