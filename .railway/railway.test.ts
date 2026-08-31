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
  PRODUCTION_RAILWAY_PROJECT_NAME,
  REHEARSAL_RAILWAY_PROJECT_NAME,
} from '../src/shared/release/railway-deployment-profile'
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
import {
  CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
  canonicalRailwayServiceSourceInput,
  parseRailwayServiceSourceInput,
  RAILWAY_FOUNDATION_SOURCE_INPUT,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
  RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  RAILWAY_SOURCE_MANAGED_SERVICES,
  type RailwayServiceSourceInput,
} from './service-source-map'

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

  it('renders from the reviewed policy name when ID-pinned CLI context omits names', () => {
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
          REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
          REPKEY_RAILWAY_PROJECT_NAME: PRODUCTION_RAILWAY_PROJECT_NAME,
          [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
        },
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
    })
  })

  it('refuses disagreement between a CLI-provided and reviewed project name', () => {
    expect(() =>
      buildRailwayProject(
        createRailwayContext({
          projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
          environmentName: 'cell-us',
        }),
        'cell-us',
        'production',
        RAILWAY_FOUNDATION_SOURCE_INPUT,
        REHEARSAL_RAILWAY_PROJECT_NAME,
      ),
    ).toThrow('Railway project identity mismatch')
  })

  it('refuses to render a valid target without an explicit source stage', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "const module = await import('./.railway/railway.ts')",
          `const graph = await module.default({ projectName: ${JSON.stringify(PRODUCTION_RAILWAY_PROJECT_NAME)}, environmentName: 'cell-us' })`,
          'process.stdout.write(JSON.stringify(graph))',
        ].join(';'),
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
          REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
          [RAILWAY_SERVICE_SOURCE_MAP_ENV]: undefined,
        },
      },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`${RAILWAY_SERVICE_SOURCE_MAP_ENV} is required`)
  })

  it('renders an explicit target with the canonical foundation input', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "const module = await import('./.railway/railway.ts')",
          `const graph = await module.default({ projectName: ${JSON.stringify(PRODUCTION_RAILWAY_PROJECT_NAME)}, environmentName: 'cell-us' })`,
          'process.stdout.write(JSON.stringify(graph))',
        ].join(';'),
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          REPKEY_RAILWAY_CELL_ENVIRONMENT: 'cell-us',
          REPKEY_RAILWAY_DEPLOYMENT_PROFILE: 'production',
          [RAILWAY_SERVICE_SOURCE_MAP_ENV]: CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT,
        },
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: PRODUCTION_RAILWAY_PROJECT_NAME,
    })
  })
})

const promotedSources = Object.freeze(
  Object.fromEntries(
    RAILWAY_SOURCE_MANAGED_SERVICES.map((serviceName, index) => [
      serviceName,
      `ghcr.io/reputation-key/${serviceName}@sha256:${String(index + 1).repeat(64)}`,
    ]),
  ),
) as Readonly<Record<(typeof RAILWAY_SOURCE_MANAGED_SERVICES)[number], string>>

const PROMOTION_SOURCE_INPUT = Object.freeze({
  version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  stage: 'promotion',
  sources: promotedSources,
} as const satisfies RailwayServiceSourceInput)

describe('Railway staged service-source contract', () => {
  it('accepts only an explicit canonical foundation or digest-pinned promotion map', () => {
    expect(
      parseRailwayServiceSourceInput(CANONICAL_RAILWAY_FOUNDATION_SOURCE_INPUT),
    ).toEqual(RAILWAY_FOUNDATION_SOURCE_INPUT)

    const canonicalPromotion = canonicalRailwayServiceSourceInput(PROMOTION_SOURCE_INPUT)
    expect(parseRailwayServiceSourceInput(canonicalPromotion)).toEqual(
      PROMOTION_SOURCE_INPUT,
    )
  })

  it('supports a canonical partial map for one-service-at-a-time promotion', () => {
    const partial = {
      version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
      stage: 'promotion',
      sources: { 'schema-migrator': promotedSources['schema-migrator'] },
    } as const satisfies RailwayServiceSourceInput

    expect(
      parseRailwayServiceSourceInput(canonicalRailwayServiceSourceInput(partial)),
    ).toEqual(partial)
  })

  it.each([
    { input: undefined, expected: /is required/ },
    { input: '', expected: /is required/ },
    { input: '{}', expected: /has non-canonical fields or order/ },
    {
      input: JSON.stringify({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'foundation',
        sources: { web: promotedSources.web },
      }),
      expected: /must not contain service sources/,
    },
    {
      input: JSON.stringify({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'promotion',
        sources: {},
      }),
      expected: /must contain at least one service source/,
    },
    {
      input: JSON.stringify({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'promotion',
        sources: { web: 'ghcr.io/reputation-key/web:mutable' },
      }),
      expected: /must be an approved registry image pinned by lowercase sha256 digest/,
    },
    {
      input: JSON.stringify({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'promotion',
        sources: { web: promotedSources.web },
      }),
      expected: /must be a canonical prefix of the staged deployment order/,
    },
    {
      input: JSON.stringify({
        version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        stage: 'promotion',
        sources: { unexpected: promotedSources.web },
      }),
      expected: /contains an unsupported service/,
    },
  ])('rejects missing, noncanonical, or unsafe input %#', ({ input, expected }) => {
    expect(() => parseRailwayServiceSourceInput(input)).toThrow(expected)
  })

  it('rejects semantically valid JSON whose byte encoding is not canonical', () => {
    const canonical = canonicalRailwayServiceSourceInput(PROMOTION_SOURCE_INPUT)
    expect(() => parseRailwayServiceSourceInput(`${canonical}\n`)).toThrow(
      'must use canonical encoding',
    )
    expect(() =>
      parseRailwayServiceSourceInput(
        JSON.stringify({
          sources: promotedSources,
          stage: 'promotion',
          version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
        }),
      ),
    ).toThrow('non-canonical fields or order')
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

function build(
  environment: string,
  deploymentProfile: 'production' | 'rehearsal' = 'production',
  sourceInput: RailwayServiceSourceInput = RAILWAY_FOUNDATION_SOURCE_INPUT,
): ProjectDefinition {
  return buildRailwayProject(
    createRailwayContext({
      projectName:
        deploymentProfile === 'production'
          ? PRODUCTION_RAILWAY_PROJECT_NAME
          : REHEARSAL_RAILWAY_PROJECT_NAME,
      environmentName: environment,
    }),
    undefined,
    deploymentProfile,
    sourceInput,
  )
}

function variableNames(service: ServiceNode): string[] {
  return Object.keys(service.variables ?? {}).sort()
}

describe('Railway Data Cell catalogue', () => {
  it('renders only the single US West beta deployment', () => {
    expect(RAILWAY_CELL_ENVIRONMENTS).toEqual(['cell-us'])
    expect(CELL_TOPOLOGIES).toEqual({
      'cell-us': {
        cellId: 'us',
        environment: 'cell-us',
        serviceRegion: 'us-west2',
        bucketRegion: 'sjc',
        publicDomain: 'us.reputationkey.app',
        providerProfile: 'gbp-production-fixed',
      },
    })
  })

  it.each([
    undefined,
    '',
    'production',
    'staging',
    'cell-eu',
    'cell-europe',
    'cell-global',
    'constructor',
    'toString',
    '__proto__',
  ])(
    'refuses unsupported or implicit environment %s instead of falling back',
    (environment) => {
      expect(() => resolveCellTopology(environment)).toThrow(
        'unsupported Railway Data Cell environment',
      )
    },
  )

  it('requires an explicit deployment profile', () => {
    expect(() =>
      buildRailwayProject(
        createRailwayContext({
          projectName: 'repkey-test',
          environmentName: 'cell-us',
        }),
      ),
    ).toThrow('Railway deployment profile must be one of production, rehearsal')
  })

  it('refuses production and rehearsal profiles in the wrong Railway project', () => {
    expect(() =>
      buildRailwayProject(
        createRailwayContext({
          projectName: REHEARSAL_RAILWAY_PROJECT_NAME,
          environmentName: 'cell-us',
        }),
        undefined,
        'production',
      ),
    ).toThrow('Railway project mismatch for production')
    expect(() =>
      buildRailwayProject(
        createRailwayContext({
          projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
          environmentName: 'cell-us',
        }),
        undefined,
        'rehearsal',
      ),
    ).toThrow('Railway project mismatch for rehearsal')
  })

  it('adds the production hostname only after the source-less foundation', () => {
    const foundationWeb = resource(
      build('cell-us', 'production'),
      'service',
      'web',
    ) as ServiceNode
    const productionWeb = resource(
      build('cell-us', 'production', PROMOTION_SOURCE_INPUT),
      'service',
      'web',
    ) as ServiceNode
    const rehearsal = build('cell-us', 'rehearsal')
    const rehearsalWeb = resource(rehearsal, 'service', 'web') as ServiceNode
    const rehearsalWorker = resource(rehearsal, 'service', 'worker') as ServiceNode

    expect(foundationWeb.networking?.customDomains).toBeUndefined()
    expect(productionWeb.networking?.customDomains).toHaveProperty('us.reputationkey.app')
    expect(rehearsalWeb.networking?.customDomains).toBeUndefined()
    expect(rehearsalWeb.variables?.BETTER_AUTH_URL).toMatchObject({
      type: 'sharedReference',
      name: 'REHEARSAL_APP_URL',
    })
    expect(rehearsalWorker.variables?.BETTER_AUTH_URL).toEqual(
      rehearsalWeb.variables?.BETTER_AUTH_URL,
    )
  })
})

describe.each(RAILWAY_CELL_ENVIRONMENTS)('%s Railway graph', (environment) => {
  const topology = CELL_TOPOLOGIES[environment]
  const definition = build(environment)

  it('co-locates every service and stateful resource', () => {
    const expectedServices = [
      'schema-migrator',
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
      // The explicit foundation stage provisions topology without runnable
      // bytes. A later source-map stage attaches exact immutable digests.
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

  it('pins the cell identity, database, Redis split, and bucket references', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    expect(web.networking?.customDomains).toBeUndefined()
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

  // D1 (owner ruling, 2026-08-29): the runtime denial of the local-sandbox
  // provider profile keys on RELEASE_MANIFEST_SHA256, which is absent until a
  // service's first promotion. These two literals are what the process reads
  // inside that dark window. The profile does NOT select endpoint URLs — those
  // come from providerConfigFor('gbp-default') plus the GBP_*_BASE_URL /
  // GOOGLE_OAUTH_*_URL overrides, none of which this file declares. What the
  // profile does select is (a) the production route target in
  // google-provider-authority.ts, whose local_sandbox alternative bypasses
  // GOOGLE_PROVIDER_PRODUCTION_ORIGINS, (b) the 'production' runtime-isolation
  // attestation expectation in composition.ts, and (c) together with
  // NODE_ENV=production, the conjunct that makes provider-runtime.ts refuse
  // endpoint overrides before the first promotion. The profile is pinned here
  // because nothing else holds it in that window. NODE_ENV is pinned here IN
  // ADDITION to the runtime images, which bake it in (Dockerfile `FROM base AS
  // web` and Dockerfile.worker `FROM base AS worker`, both `ENV
  // NODE_ENV=production`), so this pin is redundancy rather than sole cover.
  it('pins the production-fixed provider profile and NODE_ENV on web and worker', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    expect(web.variables?.GOOGLE_PROVIDER_ENDPOINT_PROFILE).toMatchObject({
      type: 'literal',
      value: 'production-fixed',
    })
    expect(worker.variables?.GOOGLE_PROVIDER_ENDPOINT_PROFILE).toEqual(
      web.variables?.GOOGLE_PROVIDER_ENDPOINT_PROFILE,
    )
    expect(web.variables?.NODE_ENV).toMatchObject({
      type: 'literal',
      value: 'production',
    })
    expect(worker.variables?.NODE_ENV).toEqual(web.variables?.NODE_ENV)
    // The overrides the profile is often assumed to gate are simply absent
    // from IaC — asserted so a later addition has to revisit this reasoning.
    for (const name of [
      'GBP_API_BASE_URL',
      'GBP_ACCOUNT_MANAGEMENT_BASE_URL',
      'GBP_PERFORMANCE_BASE_URL',
      'GBP_REVIEWS_API_BASE_URL',
      'GBP_NOTIFICATIONS_API_BASE_URL',
      'GOOGLE_OAUTH_TOKEN_URL',
      'GOOGLE_OAUTH_JWKS_URL',
      'GOOGLE_OAUTH_REVOKE_URL',
    ]) {
      expect(web.variables, name).not.toHaveProperty(name)
      expect(worker.variables, name).not.toHaveProperty(name)
    }
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

  it('keeps the signed schema bootstrap one-shot and least-privileged', () => {
    const migrator = resource(definition, 'service', 'schema-migrator') as ServiceNode

    expect(migrator.source).toBeUndefined()
    expect(migrator.build).toBeUndefined()
    expect(migrator.networking).toBeUndefined()
    expect(migrator.volumeAttachments).toBeUndefined()
    expect(migrator.deploy).toEqual({
      numReplicas: 1,
      restartPolicyType: 'NEVER',
      region: topology.serviceRegion,
      startCommand: 'node dist-worker/migrate-deploy.js',
    })
    expect(variableNames(migrator)).toEqual(
      [
        'BETTER_AUTH_SECRET',
        'DATABASE_URL',
        'NODE_ENV',
        'PROCESSING_CELL',
        'REPKEY_RAILWAY_DEPLOYMENT_PROFILE',
        'REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS',
      ].sort(),
    )
    expect(migrator.variables?.DATABASE_URL).toMatchObject({
      type: 'reference',
      resource: 'database.Postgres',
      output: 'DATABASE_URL',
    })
    for (const forbidden of [
      'REDIS_URL',
      'QUEUE_REDIS_URL',
      'PROVIDER_EPHEMERAL_REDIS_URL',
      'AWS_S3_ACCESS_KEY',
      'AWS_S3_SECRET_ACCESS_KEY',
      'AWS_S3_BUCKET_NAME',
      'GOOGLE_CLIENT_SECRET',
      'OPENAI_API_KEY',
    ]) {
      expect(migrator.variables).not.toHaveProperty(forbidden)
    }
    expect(
      (resource(definition, 'service', 'web') as ServiceNode).variables,
    ).not.toHaveProperty('REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS')
    expect(
      (resource(definition, 'service', 'worker') as ServiceNode).variables,
    ).not.toHaveProperty('REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS')
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
        'SENTRY_DSN',
        'SENTRY_TRACES_SAMPLE_RATE',
      ].sort(),
    )
    expect(variableNames(googleGateway)).toEqual(
      [
        ...GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES.filter(
          (name) => name !== 'IMAGE_SOURCE_REVISION',
        ),
        'RELEASE_MANIFEST_SHA256',
        'SENTRY_DSN',
        'SENTRY_TRACES_SAMPLE_RATE',
      ].sort(),
    )
    expect(variableNames(aiAdmission)).toEqual(
      [
        ...AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES,
        'RELEASE_MANIFEST_SHA256',
        'SENTRY_DSN',
        'SENTRY_TRACES_SAMPLE_RATE',
      ].sort(),
    )
    expect(variableNames(aiGateway)).toEqual(
      [
        ...AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES,
        'RELEASE_MANIFEST_SHA256',
        'SENTRY_DSN',
        'SENTRY_TRACES_SAMPLE_RATE',
      ].sort(),
    )
  })

  it('exposes one ordinary health port while retaining protected sidecar mTLS', () => {
    for (const name of [
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ]) {
      const sidecar = resource(definition, 'service', name) as ServiceNode
      expect(sidecar.deploy, name).toMatchObject({
        healthcheckPath: '/health/ready',
        healthcheckTimeout: 30,
        numReplicas: 1,
        region: topology.serviceRegion,
      })
      expect(sidecar.variables?.PORT, name).toMatchObject({
        type: 'literal',
        value: '8080',
      })
      expect(sidecar.variables?.INTERNAL_MTLS_PORT, name).toMatchObject({
        type: 'literal',
        value: '8443',
      })
      expect(sidecar.variables?.PROCESSING_CELL, name).toMatchObject({
        type: 'literal',
        value: 'us',
      })
      expect(sidecar.variables?.SENTRY_DSN, name).toMatchObject({
        type: 'sharedReference',
        name: 'SENTRY_DSN',
      })
      expect(sidecar.variables?.SENTRY_TRACES_SAMPLE_RATE, name).toMatchObject({
        type: 'sharedReference',
        name: 'SENTRY_TRACES_SAMPLE_RATE',
      })
    }
  })

  it('renders the explicit foundation with no service source or build', () => {
    const web = resource(definition, 'service', 'web') as ServiceNode
    const worker = resource(definition, 'service', 'worker') as ServiceNode
    for (const name of [
      'schema-migrator',
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

  it('owns every populated service source as an exact immutable image', () => {
    const promoted = build(environment, 'production', PROMOTION_SOURCE_INPUT)
    const promotedWeb = resource(promoted, 'service', 'web') as ServiceNode

    expect(promotedWeb.networking?.customDomains).toHaveProperty(topology.publicDomain)

    for (const name of RAILWAY_SOURCE_MANAGED_SERVICES) {
      const node = resource(promoted, 'service', name) as ServiceNode
      expect(node.kind, name).toBe('docker-image')
      expect(node.source, name).toEqual({
        type: 'image',
        image: promotedSources[name],
      })
      expect(node.build, name).toBeUndefined()
    }
  })

  it('keeps omitted services source-less during a staged promotion', () => {
    const schemaOnly = build(environment, 'production', {
      version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
      stage: 'promotion',
      sources: { 'schema-migrator': promotedSources['schema-migrator'] },
    })

    for (const name of RAILWAY_SOURCE_MANAGED_SERVICES) {
      const node = resource(schemaOnly, 'service', name) as ServiceNode
      if (name === 'schema-migrator') {
        expect(node.source).toEqual({
          type: 'image',
          image: promotedSources[name],
        })
      } else {
        expect(node.source, name).toBeUndefined()
      }
    }
  })

  it('preserves release-controller identity on every serving service', () => {
    const servingServices = [
      'web',
      'worker',
      'google-provider-redis',
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ]

    for (const name of servingServices) {
      const node = resource(definition, 'service', name) as ServiceNode
      expect(node.variables?.RELEASE_SHA, name).toEqual({ type: 'preserve' })
      expect(node.variables?.RELEASE_MANIFEST_SHA256, name).toEqual({
        type: 'preserve',
      })
    }

    const migrator = resource(definition, 'service', 'schema-migrator') as ServiceNode
    expect(migrator.variables).not.toHaveProperty('RELEASE_SHA')
    expect(migrator.variables).not.toHaveProperty('RELEASE_MANIFEST_SHA256')
  })
})

describe('legacy Config-as-Code ownership', () => {
  // REG-02: the cutover removes root railway*.json only once Railway stops
  // reporting a Config File owner, so until then the two ownership sets have to
  // be reconciled against the rendered graph rather than a hand-kept list.
  const graphServices = resources(build('cell-us'))
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
