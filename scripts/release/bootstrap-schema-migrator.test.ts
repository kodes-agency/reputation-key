import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotionManifestSha256,
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
import { createRailwayPlanEvidence } from '../../src/shared/release/railway-plan-evidence'
import type { RailwayPlanEvidence } from '../../src/shared/release/railway-plan-evidence'
import {
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
  RAILWAY_SOURCE_MANAGED_SERVICES,
} from '../../.railway/service-source-map'
import type { RailwayServiceSourceMap } from '../../.railway/service-source-map'
import {
  deployTimeoutMilliseconds,
  executeSignedSchemaMigrationBootstrap,
  rebindPromotionManifestAtDigest,
  schemaMigratorPlan,
  validateSchemaMigrationBootstrapContract,
  writeBootstrapAuthorizationEvidence,
} from './bootstrap-schema-migrator'
import {
  fullRailwayServiceSourceInput,
  stagedRailwayServiceSourceInput,
} from './staged-railway-sources'
import { railwayIacSourceDigest } from './iac-digest'

const hex = (value: string): string => value.repeat(64).slice(0, 64)
const imageDigest = (value: string): `sha256:${string}` => `sha256:${hex(value)}`
const TARGET = {
  projectId: 'project-opaque-id',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  environmentId: 'environment-opaque-id',
  environment: 'cell-us',
} as const

function manifest(iacSha256 = hex('1')): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-27T08:00:00.000Z',
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
      imageMetadataIndexSha256: hex('e'),
    },
    contract: {
      lockfileSha256: hex('2'),
      iacSha256,
      releaseControllerSha256: hex('c'),
      migrationHead: '0140_single_us_beta_data_cell',
      capabilityPolicyVersion: 'beta-local-2',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: hex('3'),
      testEvidenceSha256: hex('4'),
      providerApprovalEvidenceSha256: hex('5'),
      sbomIndexSha256: hex('6'),
      vulnerabilityIndexSha256: hex('7'),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
          digest: imageDigest(String((index % 8) + 1)),
          sourceRevision: releaseSha,
          sbomSha256: hex('8'),
          provenanceSha256: hex('9'),
          signatureBundleSha256: hex('a'),
          vulnerabilityReportSha256: hex('b'),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

function planEvidence(
  candidate = manifest(),
  capturedAt = new Date('2026-08-27T08:30:00.000Z'),
  exitCode = 2,
  rawPlan = exitCode === 0
    ? '{"changes":[]}'
    : '{"changes":[{"address":"service.schema-migrator"}]}',
): RailwayPlanEvidence {
  const manifestSha256 = promotionManifestSha256(canonicalPromotionManifest(candidate))
  return createRailwayPlanEvidence({
    capturedAt,
    cell: 'us',
    deploymentProfile: 'production',
    target: {
      projectName: TARGET.projectName,
      projectId: TARGET.projectId,
      environment: TARGET.environment,
      environmentId: TARGET.environmentId,
    },
    iacSha256: candidate.contract.iacSha256,
    releaseManifestSha256: manifestSha256,
    releaseControllerSha256: candidate.contract.releaseControllerSha256,
    exitCode,
    rawPlan,
  })
}

function railwayPlanJson(input: {
  currentSources: RailwayServiceSourceMap
  desiredSources: RailwayServiceSourceMap
  changes: readonly unknown[]
}): string {
  const graph = (sources: RailwayServiceSourceMap) => ({
    resources: RAILWAY_SOURCE_MANAGED_SERVICES.map((service) => ({
      address: `service.${service}`,
      type: 'service',
      name: service,
      ...(sources[service] ? { source: { type: 'image', image: sources[service] } } : {}),
    })),
  })
  return JSON.stringify({
    ok: true,
    currentEnvironment: {
      projectId: TARGET.projectId,
      projectName: TARGET.projectName,
      environmentId: TARGET.environmentId,
      environmentName: TARGET.environment,
    },
    diagnostics: [],
    changeSet: { changes: input.changes },
    currentGraph: graph(input.currentSources),
    desiredGraph: graph(input.desiredSources),
  })
}

function projectInventoryJson(schemaMigratorInSiblingEnvironment = false): string {
  const serviceRows = RAILWAY_SOURCE_MANAGED_SERVICES.map((service, index) => ({
    id: `service-${String(index)}`,
    name: service,
  }))
  const instance = (service: string, environmentId: string) => {
    const row = serviceRows.find((candidate) => candidate.name === service)
    return {
      id: `instance-${service}`,
      serviceId: row?.id,
      serviceName: service,
      environmentId,
      source: null,
    }
  }
  const targetServices = RAILWAY_SOURCE_MANAGED_SERVICES.filter(
    (service) => !schemaMigratorInSiblingEnvironment || service !== 'schema-migrator',
  )
  return JSON.stringify({
    id: TARGET.projectId,
    name: TARGET.projectName,
    deletedAt: null,
    buckets: { edges: [] },
    services: {
      edges: serviceRows.map((node) => ({ node })),
    },
    environments: {
      edges: [
        {
          node: {
            id: TARGET.environmentId,
            name: TARGET.environment,
            canAccess: true,
            deletedAt: null,
            unmergedChangesCount: 0,
            serviceInstances: {
              edges: targetServices.map((service) => ({
                node: instance(service, TARGET.environmentId),
              })),
            },
            volumeInstances: { edges: [] },
          },
        },
        ...(schemaMigratorInSiblingEnvironment
          ? [
              {
                node: {
                  id: 'sibling-environment-id',
                  name: 'production',
                  canAccess: true,
                  deletedAt: null,
                  unmergedChangesCount: 0,
                  serviceInstances: {
                    edges: [
                      {
                        node: instance('schema-migrator', 'sibling-environment-id'),
                      },
                    ],
                  },
                  volumeInstances: { edges: [] },
                },
              },
            ]
          : []),
      ],
    },
  })
}

function linkedTargetStatus(): string {
  return [
    `Project: ${TARGET.projectName}`,
    `Project ID: ${TARGET.projectId}`,
    `Environment: ${TARGET.environment}`,
    `Environment ID: ${TARGET.environmentId}`,
  ].join('\n')
}

function sourceChange(image: string) {
  return {
    kind: 'resource.update',
    summary: 'Update schema-migrator source.image, source.type',
    severity: 'safe',
    details: [
      `source.image (null → ${JSON.stringify(image)})`,
      'source.type (null → "image")',
    ],
  }
}

function rawSourceChange(image: string) {
  return {
    ...sourceChange(image),
    address: 'service.schema-migrator',
    field: 'source',
    before: null,
    after: { type: 'image', image },
    path: 'resources.service.schema-migrator.source',
    deployEffect: 'deploy',
  }
}

type RailwayTestCall = Readonly<{
  kind: 'command' | 'plan'
  args: readonly string[]
  env: NodeJS.ProcessEnv
}>

function bootstrapFixture(
  input: Readonly<{
    currentSources?: RailwayServiceSourceMap
    schemaMigratorInSiblingEnvironment?: boolean
    siblingEnvironmentObservations?: readonly boolean[]
    deploymentObservations?: readonly (readonly unknown[])[]
  }> = {},
) {
  const candidate = manifest(railwayIacSourceDigest())
  const candidateInput = fullRailwayServiceSourceInput(candidate)
  const currentSources: RailwayServiceSourceMap =
    input.currentSources ?? Object.freeze({})
  const desired = stagedRailwayServiceSourceInput(
    currentSources,
    candidateInput,
    'schema-migrator',
  )
  const retainedPlan = railwayPlanJson({
    currentSources,
    desiredSources: candidateInput.sources,
    changes: RAILWAY_SOURCE_MANAGED_SERVICES.filter(
      (service) => currentSources[service] !== candidateInput.sources[service],
    ).map((service) => ({
      kind: 'resource.update',
      summary: `Update ${service} source`,
      severity: 'safe',
      details: ['source.image'],
    })),
  })
  const savedChanges =
    currentSources['schema-migrator'] === desired.sources['schema-migrator']
      ? []
      : [sourceChange(desired.sources['schema-migrator'] ?? '')]
  const savedPlan = railwayPlanJson({
    currentSources,
    desiredSources: desired.sources,
    changes: savedChanges,
  })
  const convergedPlan = railwayPlanJson({
    currentSources: desired.sources,
    desiredSources: desired.sources,
    changes: [],
  })
  const evidence = planEvidence(candidate, undefined, 2, retainedPlan)
  const deploymentId = '11111111-1111-4111-8111-111111111111'
  const defaultObservations = [
    [
      {
        id: deploymentId,
        status: 'SUCCESS',
        meta: { imageDigest: candidate.images.web.digest },
      },
    ],
  ] as const
  const deploymentObservations = input.deploymentObservations ?? defaultObservations
  const calls: RailwayTestCall[] = []
  let mutationTriggered = false
  let deploymentPoll = 0
  let isolationPoll = 0
  let fullCandidatePlanDelivered = false

  const railway = (args: readonly string[], env: NodeJS.ProcessEnv): string => {
    calls.push({ kind: 'command', args: [...args], env })
    if (args[0] === '--version') return 'railway 5.45.2'
    if (args[0] === 'status' && args[1] === '--json') {
      const observations = input.siblingEnvironmentObservations ?? [
        input.schemaMigratorInSiblingEnvironment ?? false,
      ]
      const observation =
        observations[Math.min(isolationPoll, observations.length - 1)] ?? false
      isolationPoll += 1
      return projectInventoryJson(observation)
    }
    if (args[0] === 'status') return linkedTargetStatus()
    if (args[0] === 'deployment') {
      if (!mutationTriggered) return '[]'
      const observation =
        deploymentObservations[
          Math.min(deploymentPoll, deploymentObservations.length - 1)
        ] ?? []
      deploymentPoll += 1
      return JSON.stringify(observation)
    }
    if (args[0] === 'config' && args[1] === 'apply') {
      mutationTriggered = true
      return JSON.stringify({
        status: 'complete',
        diagnostics: [],
        changes: [
          {
            kind: 'resource.update',
            path: 'resources.service.schema-migrator.source',
            status: 'applied',
          },
        ],
      })
    }
    if (args[0] === 'service' && args[1] === 'redeploy') {
      mutationTriggered = true
      return '{"success":true}'
    }
    throw new Error(`unexpected Railway command: ${args.join(' ')}`)
  }
  const railwayPlan = (
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ): Readonly<{ stdout: string; status: number }> => {
    calls.push({ kind: 'plan', args: [...args], env })
    if (args.includes('--out')) {
      const outputIndex = args.indexOf('--out')
      const outputPath = args[outputIndex + 1]
      if (!outputPath) throw new Error('saved plan output path is missing')
      writeFileSync(
        outputPath,
        JSON.stringify({
          kind: 'railway.config.plan',
          version: 1,
          environmentId: TARGET.environmentId,
          destructive: false,
          changeSet: {
            changes:
              savedChanges.length === 0
                ? []
                : [rawSourceChange(desired.sources['schema-migrator'] ?? '')],
          },
        }),
      )
      return { stdout: savedPlan, status: savedChanges.length === 0 ? 0 : 2 }
    }
    if (!fullCandidatePlanDelivered) {
      fullCandidatePlanDelivered = true
      return { stdout: retainedPlan, status: 2 }
    }
    return { stdout: convergedPlan, status: 0 }
  }

  return {
    calls,
    candidate,
    candidateInput,
    deploymentId,
    desired,
    evidence,
    railway,
    railwayPlan,
  }
}

describe('signed schema migration bootstrap', () => {
  it('bounds the Railway settlement timeout to a finite positive integer', () => {
    expect(deployTimeoutMilliseconds(undefined)).toBe(900_000)
    expect(deployTimeoutMilliseconds('3600')).toBe(3_600_000)
    for (const value of ['0', '-1', '1.5', '3601', '1e309']) {
      expect(() => deployTimeoutMilliseconds(value)).toThrow(
        'positive integer no greater than 3600 seconds',
      )
    }
  })

  it('uses only the signed web image for the one-shot schema migrator', () => {
    const candidate = manifest()
    expect(schemaMigratorPlan(candidate)).toEqual({
      service: 'schema-migrator',
      imageReference: `${candidate.images.web.repository}@${candidate.images.web.digest}`,
      imageDigest: candidate.images.web.digest,
    })
  })

  it('rebinds apply to the exact manifest bytes verified by Cosign', () => {
    const content = canonicalPromotionManifest(manifest())
    const parsed = parsePromotionManifest(content)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(rebindPromotionManifestAtDigest(content, parsed.digest)).toEqual(
      parsed.manifest,
    )

    const swappedContent = canonicalPromotionManifest(manifest(hex('f')))
    expect(() => rebindPromotionManifestAtDigest(swappedContent, parsed.digest)).toThrow(
      'does not match expected',
    )
  })

  it('binds a fresh reviewable plan to the signed manifest, IaC, and migration head', () => {
    const candidate = manifest()
    expect(() =>
      validateSchemaMigrationBootstrapContract(candidate, planEvidence(candidate), {
        cell: 'us',
        currentIacSha256: hex('1'),
        currentReleaseControllerSha256: hex('c'),
        currentMigrationHead: '0140_single_us_beta_data_cell',
        now: new Date('2026-08-27T09:00:00.000Z'),
      }),
    ).not.toThrow()
    expect(() =>
      validateSchemaMigrationBootstrapContract(
        candidate,
        planEvidence(candidate, undefined, 0),
        {
          cell: 'us',
          currentIacSha256: hex('1'),
          currentReleaseControllerSha256: hex('c'),
          currentMigrationHead: '0140_single_us_beta_data_cell',
          now: new Date('2026-08-27T09:00:00.000Z'),
        },
      ),
    ).not.toThrow()

    expect(() =>
      validateSchemaMigrationBootstrapContract(candidate, planEvidence(candidate), {
        cell: 'us',
        currentIacSha256: hex('c'),
        currentReleaseControllerSha256: hex('c'),
        currentMigrationHead: '0140_single_us_beta_data_cell',
        now: new Date('2026-08-27T09:00:00.000Z'),
      }),
    ).toThrow('current Railway IaC digest')
    expect(() =>
      validateSchemaMigrationBootstrapContract(candidate, planEvidence(candidate), {
        cell: 'us',
        currentIacSha256: hex('1'),
        currentReleaseControllerSha256: hex('f'),
        currentMigrationHead: '0140_single_us_beta_data_cell',
        now: new Date('2026-08-27T09:00:00.000Z'),
      }),
    ).toThrow('local release-controller digest')
    expect(() =>
      validateSchemaMigrationBootstrapContract(
        candidate,
        {
          ...planEvidence(candidate),
          release: {
            ...planEvidence(candidate).release,
            controllerSha256: hex('f'),
          },
        },
        {
          cell: 'us',
          currentIacSha256: hex('1'),
          currentReleaseControllerSha256: hex('c'),
          currentMigrationHead: '0140_single_us_beta_data_cell',
          now: new Date('2026-08-27T09:00:00.000Z'),
        },
      ),
    ).toThrow('Railway plan controller digest')
    expect(() =>
      validateSchemaMigrationBootstrapContract(
        candidate,
        {
          ...planEvidence(candidate),
          release: {
            ...planEvidence(candidate).release,
            manifestSha256: hex('f'),
          },
        },
        {
          cell: 'us',
          currentIacSha256: hex('1'),
          currentReleaseControllerSha256: hex('c'),
          currentMigrationHead: '0140_single_us_beta_data_cell',
          now: new Date('2026-08-27T09:00:00.000Z'),
        },
      ),
    ).toThrow('does not match promotion manifest digest')
  })

  it('pins opaque target IDs, replans, deploys, and proves SUCCESS at the exact digest', async () => {
    const fixture = bootstrapFixture()

    const result = await executeSignedSchemaMigrationBootstrap({
      manifest: fixture.candidate,
      evidence: fixture.evidence,
      timeoutMs: 1_000,
      railway: fixture.railway,
      railwayPlan: fixture.railwayPlan,
      sleep: async () => undefined,
    })

    expect(result).toEqual({
      deploymentId: fixture.deploymentId,
      imageDigest: fixture.candidate.images.web.digest,
      status: 'SUCCESS',
    })
    for (const call of fixture.calls) {
      expect(call.env.RAILWAY_PROJECT_ID).toBe(TARGET.projectId)
      expect(call.env.RAILWAY_ENVIRONMENT_ID).toBe(TARGET.environmentId)
    }
    expect(
      fixture.calls.find(({ args }) => args[0] === 'status' && args[1] === '--json')
        ?.args,
    ).toEqual(['status', '--json'])
    const savedPlan = fixture.calls.find(
      ({ kind, args }) => kind === 'plan' && args.includes('--out'),
    )
    const savedPlanPath = savedPlan?.args[savedPlan.args.indexOf('--out') + 1]
    expect(savedPlanPath).toBeTruthy()
    expect(
      fixture.calls.find(({ args }) => args[0] === 'config' && args[1] === 'apply')?.args,
    ).toEqual(['config', 'apply', '--plan', savedPlanPath, '--yes', '--json'])
    const isolationCall = (call: RailwayTestCall | undefined): boolean =>
      call?.kind === 'command' && call.args[0] === 'status' && call.args[1] === '--json'
    const savedPlanIndex = fixture.calls.indexOf(savedPlan as RailwayTestCall)
    const applyIndex = fixture.calls.findIndex(
      ({ args }) => args[0] === 'config' && args[1] === 'apply',
    )
    expect(isolationCall(fixture.calls[savedPlanIndex - 1])).toBe(true)
    expect(isolationCall(fixture.calls[applyIndex - 1])).toBe(true)
    expect(isolationCall(fixture.calls.at(-1))).toBe(true)
    expect(fixture.calls.filter(isolationCall)).toHaveLength(4)
    expect(
      fixture.calls.some(({ args }) => args[0] === 'service' && args[1] === 'source'),
    ).toBe(false)
    const planCalls = fixture.calls.filter(
      ({ kind, args }) => kind === 'plan' && args[0] === 'config' && args[1] === 'plan',
    )
    expect(planCalls).toHaveLength(3)
    expect(planCalls[0]?.env[RAILWAY_SERVICE_SOURCE_MAP_ENV]).toBe(
      JSON.stringify(fixture.candidateInput),
    )
    expect(savedPlan?.env[RAILWAY_SERVICE_SOURCE_MAP_ENV]).toBe(
      JSON.stringify(fixture.desired),
    )
    expect(planCalls.at(-1)?.env[RAILWAY_SERVICE_SOURCE_MAP_ENV]).toBe(
      JSON.stringify(fixture.desired),
    )
  })

  it('refuses a successful deployment whose observed image digest differs', async () => {
    const candidate = manifest()
    const deploymentId = '11111111-1111-4111-8111-111111111111'
    const fixture = bootstrapFixture({
      deploymentObservations: [
        [
          {
            id: deploymentId,
            status: 'DEPLOYING',
            meta: { imageDigest: candidate.images.web.digest },
          },
        ],
        [
          {
            id: deploymentId,
            status: 'SUCCESS',
            meta: { imageDigest: imageDigest('f') },
          },
        ],
      ],
    })

    await expect(
      executeSignedSchemaMigrationBootstrap({
        manifest: fixture.candidate,
        evidence: fixture.evidence,
        timeoutMs: 1_000,
        railway: fixture.railway,
        railwayPlan: fixture.railwayPlan,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('does not match signed')
  })

  it('refuses a source-managed service in a sibling environment before planning or applying', async () => {
    const fixture = bootstrapFixture({ schemaMigratorInSiblingEnvironment: true })

    await expect(
      executeSignedSchemaMigrationBootstrap({
        manifest: fixture.candidate,
        evidence: fixture.evidence,
        timeoutMs: 1_000,
        railway: fixture.railway,
        railwayPlan: fixture.railwayPlan,
      }),
    ).rejects.toThrow(
      'dedicated Railway beta project must contain exactly one environment; observed 2',
    )
    expect(fixture.calls.some(({ kind }) => kind === 'plan')).toBe(false)
    expect(
      fixture.calls.some(({ args }) => args[0] === 'config' && args[1] === 'apply'),
    ).toBe(false)
  })

  it('refuses project isolation drift immediately before the saved apply', async () => {
    const fixture = bootstrapFixture({
      siblingEnvironmentObservations: [false, false, true],
    })

    await expect(
      executeSignedSchemaMigrationBootstrap({
        manifest: fixture.candidate,
        evidence: fixture.evidence,
        timeoutMs: 1_000,
        railway: fixture.railway,
        railwayPlan: fixture.railwayPlan,
      }),
    ).rejects.toThrow(
      'dedicated Railway beta project must contain exactly one environment; observed 2',
    )
    expect(
      fixture.calls.some(({ args }) => args[0] === 'config' && args[1] === 'apply'),
    ).toBe(false)
  })

  it('refuses project isolation drift after the bootstrap deployment settles', async () => {
    const fixture = bootstrapFixture({
      siblingEnvironmentObservations: [false, false, false, true],
    })

    await expect(
      executeSignedSchemaMigrationBootstrap({
        manifest: fixture.candidate,
        evidence: fixture.evidence,
        timeoutMs: 1_000,
        railway: fixture.railway,
        railwayPlan: fixture.railwayPlan,
      }),
    ).rejects.toThrow(
      'dedicated Railway beta project must contain exactly one environment; observed 2',
    )
    expect(
      fixture.calls.some(({ args }) => args[0] === 'config' && args[1] === 'apply'),
    ).toBe(true)
    expect(fixture.calls.at(-1)?.args.slice(0, 2)).toEqual(['status', '--json'])
  })

  it('recovers a same-digest partial retry with one explicit deploy from source', async () => {
    const candidate = manifest()
    const candidateInput = fullRailwayServiceSourceInput(candidate)
    const currentSources = Object.freeze({
      'schema-migrator': candidateInput.sources['schema-migrator'],
    })
    const fixture = bootstrapFixture({ currentSources })

    await expect(
      executeSignedSchemaMigrationBootstrap({
        manifest: fixture.candidate,
        evidence: fixture.evidence,
        timeoutMs: 1_000,
        railway: fixture.railway,
        railwayPlan: fixture.railwayPlan,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({
      deploymentId: fixture.deploymentId,
      status: 'SUCCESS',
    })
    const redeploy = fixture.calls.find(
      ({ args }) => args[0] === 'service' && args[1] === 'redeploy',
    )
    expect(redeploy?.args).toEqual(
      expect.arrayContaining([
        '--from-source',
        '--yes',
        '--project',
        'project-opaque-id',
        '--environment',
        'environment-opaque-id',
      ]),
    )
    expect(
      fixture.calls.some(({ args }) => args[0] === 'config' && args[1] === 'apply'),
    ).toBe(false)
  })

  it('creates bootstrap authorization evidence and its digest sidecar only once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'repkey-schema-bootstrap-'))
    const path = join(directory, 'authorization.json')
    try {
      const digest = writeBootstrapAuthorizationEvidence(path, '{"ok":true}\n')
      expect(readFileSync(path, 'utf8')).toBe('{"ok":true}\n')
      expect(readFileSync(`${path}.sha256`, 'utf8')).toBe(
        `${digest}  authorization.json\n`,
      )
      expect(() => writeBootstrapAuthorizationEvidence(path, '{"ok":false}\n')).toThrow(
        /EEXIST|file already exists/u,
      )
      expect(readFileSync(path, 'utf8')).toBe('{"ok":true}\n')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses pinned IaC plans without uploads or project-wide source-connect mutations', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/bootstrap-schema-migrator.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/railway(?:\(\[|\s+)['"]?up\b/u)
    expect(source).not.toMatch(/['"]source['"],\s*['"]connect['"]/u)
    expect(source).toContain('railwayPinnedPlanArgs(')
    expect(source).toContain('railwayPinnedApplyArgs(')
  })
})
