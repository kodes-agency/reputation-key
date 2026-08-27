import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createRailwayContext,
  type BucketNode,
  type DatabaseNode,
  type ProjectDefinition,
  type ResourceNode,
  type ServiceNode,
} from 'railway/iac'
import { AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES } from '../services/ai-egress-gateway/environment'
import { AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES } from '../services/ai-execution-admission/environment'
import { GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES } from '../services/google-execution-admission/environment'
import { GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES } from '../services/google-egress-gateway/environment'
import {
  CELL_TOPOLOGIES,
  RAILWAY_CELL_ENVIRONMENTS,
  resolveCellTopology,
} from './cell-topology'
import {
  readLegacyConfigFiles,
  reconcileLegacyConfigOwnership,
} from './legacy-config-ownership'
import { buildRailwayProject } from './railway'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('Railway CLI module evaluation', () => {
  it('loads the checked-in TypeScript graph with native Node resolution', () => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./.railway/railway.ts')"],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
      },
    )

    expect(result.status, result.stderr).toBe(0)
  })

  it('evaluates an explicitly selected Data Cell when the CLI supplies an empty context', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "const module = await import('./.railway/railway.ts')",
          'const graph = await module.default({})',
          'process.stdout.write(JSON.stringify(graph))',
        ].join(';'),
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
        },
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ name: 'repkey-data-cells' })
  })
})

function resources(project: ProjectDefinition): ResourceNode[] {
  return (project.resources ?? []).flat() as ResourceNode[]
}

function resource<T extends ResourceNode['type']>(
  definition: ProjectDefinition,
  type: T,
  name: string,
): Extract<ResourceNode, { type: T }> {
  const found = resources(definition).find(
    (candidate) => candidate.type === type && candidate.name === name,
  )
  if (!found) throw new Error(`missing ${type}.${name}`)
  return found as Extract<ResourceNode, { type: T }>
}

function build(environment: string): ProjectDefinition {
  return buildRailwayProject(
    createRailwayContext({
      projectName: 'repkey-test',
      environmentName: environment,
    }),
  )
}

function variableNames(service: ServiceNode): string[] {
  return Object.keys(service.variables ?? {}).sort()
}

describe('Railway Data Cell catalogue', () => {
  it('has one explicit physical placement and domain per logical cell', () => {
    expect(RAILWAY_CELL_ENVIRONMENTS).toEqual(['cell-us', 'cell-europe', 'cell-global'])
    expect(CELL_TOPOLOGIES).toMatchObject({
      'cell-us': {
        serviceRegion: 'us-west2',
        bucketRegion: 'sjc',
        publicDomain: 'us.reputationkey.app',
      },
      'cell-europe': {
        serviceRegion: 'europe-west4-drams3a',
        bucketRegion: 'ams',
        publicDomain: 'eu.reputationkey.app',
      },
      'cell-global': {
        serviceRegion: 'asia-southeast1-eqsg3a',
        bucketRegion: 'sin',
        publicDomain: 'global.reputationkey.app',
      },
    })
  })

  it.each([undefined, '', 'production', 'staging', 'cell-eu'])(
    'refuses unsupported or implicit environment %s instead of falling back',
    (environment) => {
      expect(() => resolveCellTopology(environment)).toThrow(
        'unsupported Railway Data Cell environment',
      )
    },
  )
})

describe.each(RAILWAY_CELL_ENVIRONMENTS)('%s Railway graph', (environment) => {
  const topology = CELL_TOPOLOGIES[environment]
  const definition = build(environment)

  it('co-locates every service and stateful resource', () => {
    const expectedServices = [
      'web',
      'worker',
      'google-provider-redis',
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ]
    for (const name of expectedServices) {
      const node = resource(definition, 'service', name) as ServiceNode
      expect(node.deploy?.region).toBe(topology.serviceRegion)
      // IaC owns topology/settings; REG-03's signed release manifest owns the
      // immutable image digest, so the graph must not reintroduce Git builds.
      expect(node.source).toBeUndefined()
    }
    for (const name of ['Postgres', 'Cache Redis', 'Queue Redis']) {
      expect(
        (resource(definition, 'database', name) as DatabaseNode).deploy
          ?.multiRegionConfig,
      ).toEqual({ [topology.serviceRegion]: { numReplicas: 1 } })
    }
    expect(
      (resource(definition, 'bucket', 'object-store') as BucketNode).config?.region,
    ).toBe(topology.bucketRegion)
    const providerRedis = resource(
      definition,
      'service',
      'google-provider-redis',
    ) as ServiceNode
    expect(providerRedis.volumeAttachments).toBeUndefined()
    expect(providerRedis.networking?.tcpProxies).toBeUndefined()
    expect(variableNames(providerRedis)).toEqual([
      'PROVIDER_EPHEMERAL_REDIS_URL',
      'PROVIDER_REDIS_TLS_CA_PEM',
      'PROVIDER_REDIS_TLS_CERT_PEM',
      'PROVIDER_REDIS_TLS_KEY_PEM',
      'RELEASE_MANIFEST_SHA256',
      'RELEASE_SHA',
    ])
  })

  it('pins the cell identity, domain, database, Redis split, and bucket references', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    expect(web.networking?.customDomains).toHaveProperty(topology.publicDomain)
    expect(web.variables?.BETTER_AUTH_URL).toMatchObject({
      type: 'literal',
      value: `https://${topology.publicDomain}`,
    })
    expect(web.variables?.PROCESSING_CELL).toMatchObject({
      type: 'literal',
      value: topology.cellId,
    })
    expect(worker.variables?.PROCESSING_CELL).toEqual(web.variables?.PROCESSING_CELL)
    expect(web.variables?.DATABASE_URL).toMatchObject({
      type: 'reference',
      resource: 'database.Postgres',
      output: 'DATABASE_URL',
    })
    expect(web.variables?.REDIS_URL).toMatchObject({
      type: 'reference',
      resource: 'database.Cache Redis',
      output: 'REDIS_URL',
    })
    expect(web.variables?.QUEUE_REDIS_URL).toMatchObject({
      type: 'reference',
      resource: 'database.Queue Redis',
      output: 'REDIS_URL',
    })
    expect(worker.variables?.REDIS_URL).toEqual(web.variables?.REDIS_URL)
    expect(worker.variables?.QUEUE_REDIS_URL).toEqual(web.variables?.QUEUE_REDIS_URL)
    expect(web.variables?.PROVIDER_EPHEMERAL_REDIS_URL).toMatchObject({
      type: 'sharedReference',
      name: 'PROVIDER_EPHEMERAL_REDIS_URL',
    })
    expect(web.variables?.PROVIDER_EPHEMERAL_REDIS_CA_PEM).toMatchObject({
      type: 'sharedReference',
      name: 'PROVIDER_REDIS_TLS_CA_PEM',
    })
    expect(web.variables?.AWS_S3_BUCKET_NAME).toMatchObject({
      type: 'reference',
      resource: 'bucket.object-store',
      output: 'BUCKET',
    })
  })

  it('keeps worker-only pseudonym authorities out of web', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    for (const name of ['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS', 'AI_SUBJECT_HMAC_KEYS']) {
      expect(web.variables).not.toHaveProperty(name)
      expect(worker.variables).toHaveProperty(name)
    }
    expect(web.variables?.GOOGLE_INTERNAL_MTLS_CERT_B64).not.toEqual(
      worker.variables?.GOOGLE_INTERNAL_MTLS_CERT_B64,
    )
    expect(web.variables?.AI_INTERNAL_MTLS_CERT_B64).not.toEqual(
      worker.variables?.AI_INTERNAL_MTLS_CERT_B64,
    )
  })

  it('matches the exact admission and AI gateway process allowlists', () => {
    const googleAdmission = resource(
      definition,
      'service',
      'google-execution-admission',
    ) as ServiceNode
    const aiAdmission = resource(
      definition,
      'service',
      'ai-execution-admission',
    ) as ServiceNode
    const googleGateway = resource(
      definition,
      'service',
      'google-egress-gateway',
    ) as ServiceNode
    const aiGateway = resource(definition, 'service', 'ai-egress-gateway') as ServiceNode
    const providerRedis = resource(
      definition,
      'service',
      'google-provider-redis',
    ) as ServiceNode
    expect(variableNames(providerRedis)).toEqual(
      [
        'PROVIDER_EPHEMERAL_REDIS_URL',
        'PROVIDER_REDIS_TLS_CA_PEM',
        'PROVIDER_REDIS_TLS_CERT_PEM',
        'PROVIDER_REDIS_TLS_KEY_PEM',
        'RELEASE_MANIFEST_SHA256',
        'RELEASE_SHA',
      ].sort(),
    )
    expect(variableNames(googleAdmission)).toEqual(
      [
        ...GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES.filter(
          (name) => name !== 'IMAGE_SOURCE_REVISION',
        ),
        'PROVIDER_REDIS_TLS_CA_PEM',
        'RELEASE_MANIFEST_SHA256',
      ].sort(),
    )
    expect(variableNames(googleGateway)).toEqual(
      [
        ...GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES.filter(
          (name) => name !== 'IMAGE_SOURCE_REVISION',
        ),
        'RELEASE_MANIFEST_SHA256',
      ].sort(),
    )
    expect(variableNames(aiAdmission)).toEqual(
      [...AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES, 'RELEASE_MANIFEST_SHA256'].sort(),
    )
    expect(variableNames(aiGateway)).toEqual(
      [...AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES, 'RELEASE_MANIFEST_SHA256'].sort(),
    )
  })

  it('owns deploy configuration while signed promotion exclusively owns image source', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    for (const name of [
      'web',
      'worker',
      'google-provider-redis',
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ]) {
      const node = resource(definition, 'service', name) as ServiceNode
      expect(node.source).toBeUndefined()
      expect(node.build).toBeUndefined()
      expect(node.variables).not.toHaveProperty('IMAGE_SOURCE_REVISION')
    }
    expect(web.deploy).toMatchObject({
      preDeployCommand: ['node dist-worker/migrate-deploy.js'],
      healthcheckPath: '/api/health/ready',
      healthcheckTimeout: 30,
      numReplicas: 1,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      drainingSeconds: 30,
    })
    expect(worker.deploy).toMatchObject({
      numReplicas: 1,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      drainingSeconds: 30,
    })
  })
})

describe('legacy Config-as-Code ownership', () => {
  // REG-02: the cutover removes root railway*.json only once Railway stops
  // reporting a Config File owner, so until then the two ownership sets have to
  // be reconciled against the rendered graph rather than a hand-kept list.
  const graphServices = resources(build('cell-europe'))
    .filter((node) => node.type === 'service')
    .map((node) => node.name)

  it('accounts for every root railway*.json and every graph service', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: readLegacyConfigFiles(REPOSITORY_ROOT),
      graphServices,
    })

    expect(report.violations).toEqual([])
  })

  it('names the exact files the cutover still has to delete', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: readLegacyConfigFiles(REPOSITORY_ROOT),
      graphServices,
    })

    expect(report.dualOwnership).toEqual([
      'railway.ai-egress-gateway.json',
      'railway.ai-execution-admission.json',
      'railway.google-egress-gateway.json',
      'railway.google-execution-admission.json',
      'railway.json',
      'railway.worker.json',
    ])
  })
})
