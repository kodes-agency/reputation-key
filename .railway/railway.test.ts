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
import { buildRailwayProject } from './railway'

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
    for (const name of ['Postgres', 'Redis', 'google-provider-redis']) {
      expect(
        (resource(definition, 'database', name) as DatabaseNode).deploy
          ?.multiRegionConfig,
      ).toEqual({ [topology.serviceRegion]: { numReplicas: 1 } })
    }
    expect(
      (resource(definition, 'bucket', 'object-store') as BucketNode).config?.region,
    ).toBe(topology.bucketRegion)
  })

  it('pins the cell identity, domain, database, cache, and bucket references', () => {
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
    expect(web.variables?.PROVIDER_EPHEMERAL_REDIS_URL).toMatchObject({
      type: 'reference',
      resource: 'database.google-provider-redis',
      output: 'REDIS_PUBLIC_URL',
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
    expect(variableNames(googleAdmission)).toEqual(
      [
        ...GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES.filter(
          (name) => name !== 'IMAGE_SOURCE_REVISION',
        ),
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
      healthcheckPath: '/api/health/started',
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
