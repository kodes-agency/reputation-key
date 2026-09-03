import {
  bucket,
  createRailwayContext,
  defineRailway,
  group,
  image,
  postgres,
  preserve,
  project,
  redis,
  ref,
  service,
  type ProjectDefinition,
  type RailwayContext,
  type VariableValue,
} from 'railway/iac'
import { resolveCellTopology } from './cell-topology.ts'
import {
  assertRailwayProjectNameForProfile,
  REPKEY_RAILWAY_PROJECT_NAME_ENV,
  requireRailwayDeploymentProfile,
} from '../src/shared/release/railway-deployment-profile.ts'
import {
  parseRailwayServiceSourceInput,
  RAILWAY_SERVICE_SOURCE_MAP_ENV,
  type RailwayServiceSourceInput,
  type RailwaySourceManagedService,
} from './service-source-map.ts'

export const APPLICATION_SERVICE_NAMES = ['web', 'worker'] as const

export const APPLICATION_SHARED_VARIABLES = [
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS',
  'EMAIL_FROM',
  'OPS_METRICS_TOKEN',
  'ALERT_WEBHOOK_URL',
  'OPS_OPERATOR_IDENTITIES',
  'LOG_LEVEL',
  'SENTRY_DSN',
  'SENTRY_TRACES_SAMPLE_RATE',
  'GUEST_SESSION_SALT',
  'PORTAL_TOKEN_HASH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ENCRYPTION_KEY',
  'OAUTH_STATE_SECRET',
  'GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS',
  'GOOGLE_SESSION_BINDING_HMAC_KEYS',
  'GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS',
  'GOOGLE_REPLAY_HMAC_KEYS',
  'GOOGLE_RUNTIME_ISOLATION_PROFILE_JSON',
  'GOOGLE_CONTROL_PLANE_POLICY_GENERATION',
  'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON',
  'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON',
  'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
  'AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON',
  'AI_KEY_INVENTORY_PROFILE',
  'GBP_PUBSUB_AUDIENCE',
  'GBP_PUBSUB_TOPIC',
  'GBP_PUBSUB_NOTIFICATION_TYPES',
  'GBP_PUBSUB_PUSH_SERVICE_ACCOUNT',
  'REVIEW_DISCOVERY_INTERVAL_MINUTES',
  'ENABLE_CUSTOM_ROLES',
  'EMAIL_VERIFICATION_REQUIRED',
  'BETA_CAPABILITIES_OFF',
  'BETA_ALLOWLIST_ORGS',
  'BETA_SUSPENDED_ORGS',
  'OUTBOX_DISPATCHER_ENABLED',
  'TRUSTED_PROXY_MODE',
  'TRUSTED_PROXY_COUNT',
  'TRUSTED_PROXY_MAX_HOPS',
  'REQUEST_BODY_LIMIT_BYTES',
  'DRAIN_BUDGET_MS',
  'QUARANTINE_TTL_DAYS',
] as const

const WORKER_ONLY_VARIABLES = [
  'REVIEW_PROVIDER_SUBJECT_HMAC_KEYS',
  'AI_SUBJECT_HMAC_KEYS',
] as const

const AI_GATEWAY_SHARED_VARIABLES = [
  'OPENAI_API_KEY',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_REQUEST_BINDING_KEYRING_GENERATION',
  'AI_SAFETY_IDENTIFIER_HMAC_KEYS',
  'AI_SAFETY_IDENTIFIER_KEYRING_GENERATION',
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
  'AI_ADMISSION_KEYRING_GENERATION',
  'AI_PROVENANCE_ED25519_PRIVATE_KEY_B64',
  'AI_PROVENANCE_ED25519_KID',
  'AI_PROVENANCE_KEYRING_GENERATION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
  'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
  'AI_GATEWAY_BUILD_ATTESTATION_DIGEST',
] as const

const AI_ADMISSION_SHARED_VARIABLES = [
  'AI_CONTROL_DATABASE_URL',
  'AI_CONTROL_DATABASE_CA_B64',
  'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
  'AI_ADMISSION_ED25519_KID',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_REQUEST_BINDING_KEYRING_GENERATION',
  'AI_ADMISSION_KEYRING_GENERATION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
  'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
] as const

function sharedVariables(
  ctx: RailwayContext,
  names: readonly string[],
): Record<string, VariableValue> {
  return Object.fromEntries(names.map((name) => [name, ctx.shared[name]]))
}

// The signed release controller writes these values per service immediately
// before the saved IaC plan advances the immutable image digest. IaC declares
// their existence, but must preserve the live controller-owned values so a
// later config plan/apply neither reports drift nor replaces release identity
// with an environment-level shared reference.
function releaseControlledVariables(): Record<string, VariableValue> {
  return {
    RELEASE_SHA: preserve(),
    RELEASE_MANIFEST_SHA256: preserve(),
  }
}

function appTlsVariables(ctx: RailwayContext, process: 'WEB' | 'WORKER') {
  return {
    GOOGLE_EGRESS_GATEWAY_ORIGIN: 'https://google-egress-gateway.railway.internal:8443',
    GOOGLE_EGRESS_GATEWAY_SERVER_NAME: 'google-egress-gateway',
    GOOGLE_INTERNAL_MTLS_CA_B64: ctx.shared.GOOGLE_INTERNAL_MTLS_CA_B64,
    GOOGLE_INTERNAL_MTLS_CERT_B64: ctx.shared[`GOOGLE_${process}_MTLS_CERT_B64`],
    GOOGLE_INTERNAL_MTLS_KEY_B64: ctx.shared[`GOOGLE_${process}_MTLS_KEY_B64`],
    AI_EGRESS_GATEWAY_ORIGIN: 'https://ai-egress-gateway.railway.internal:8443',
    AI_EGRESS_GATEWAY_SERVER_NAME: 'ai-egress-gateway',
    AI_INTERNAL_MTLS_CA_B64: ctx.shared.AI_INTERNAL_MTLS_CA_B64,
    AI_INTERNAL_MTLS_CERT_B64: ctx.shared[`AI_${process}_MTLS_CERT_B64`],
    AI_INTERNAL_MTLS_KEY_B64: ctx.shared[`AI_${process}_MTLS_KEY_B64`],
  }
}

const servingDeploy = (region: string, drainingSeconds: number) => ({
  numReplicas: 1,
  restartPolicyType: 'ON_FAILURE' as const,
  restartPolicyMaxRetries: 10,
  drainingSeconds,
  region,
})

const sidecarDeploy = (region: string, drainingSeconds: number) => ({
  ...servingDeploy(region, drainingSeconds),
  healthcheckPath: '/health/ready',
  healthcheckTimeout: 30,
})

function sidecarOperationalVariables(
  ctx: RailwayContext,
  cellId: string,
  host: '0.0.0.0' | '::',
): Record<string, string | VariableValue> {
  return {
    HOST: host,
    // Railway probes the ordinary HTTP listener selected by PORT. Protected
    // application/admission traffic stays on the distinct private mTLS port.
    PORT: '8080',
    INTERNAL_MTLS_PORT: '8443',
    PROCESSING_CELL: cellId,
    SENTRY_DSN: ctx.shared.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: ctx.shared.SENTRY_TRACES_SAMPLE_RATE,
  }
}

function railwayServiceSource(
  sourceInput: RailwayServiceSourceInput,
  serviceName: RailwaySourceManagedService,
) {
  const reference = sourceInput.sources[serviceName]
  return reference === undefined ? undefined : image(reference)
}

// REG-03 gives this environment graph sole source ownership. Foundation
// provisioning is explicitly source-less; every populated promotion entry is
// an immutable registry digest. GitHub/local/mutable-tag sources remain
// impossible through this contract.

/** Exported for offline topology/allowlist tests; the CLI consumes the default. */
export function buildRailwayProject(
  ctx: RailwayContext,
  requestedEnvironment?: string,
  requestedDeploymentProfile?: string,
  requestedSourceInput?: RailwayServiceSourceInput,
  requestedProjectName?: string,
): ProjectDefinition {
  const contextEnvironment = ctx.environmentName ?? ctx.environment
  if (
    contextEnvironment &&
    requestedEnvironment &&
    contextEnvironment !== requestedEnvironment
  ) {
    throw new Error(
      `Railway Data Cell environment mismatch: context=${contextEnvironment}, requested=${requestedEnvironment}`,
    )
  }
  const cell = resolveCellTopology(contextEnvironment ?? requestedEnvironment)
  const deploymentProfile = requireRailwayDeploymentProfile(requestedDeploymentProfile)
  const projectName = requestedProjectName ?? ctx.projectName
  if (!projectName) {
    throw new Error('Railway project identity is required to render a Data Cell')
  }
  if (
    ctx.projectName &&
    requestedProjectName &&
    ctx.projectName !== requestedProjectName
  ) {
    throw new Error(
      `Railway project identity mismatch: context=${ctx.projectName}, requested=${requestedProjectName}`,
    )
  }
  assertRailwayProjectNameForProfile(deploymentProfile, projectName)
  const sourceInput =
    requestedSourceInput ??
    parseRailwayServiceSourceInput(process.env[RAILWAY_SERVICE_SOURCE_MAP_ENV])
  const applicationUrl: VariableValue =
    deploymentProfile === 'production'
      ? `https://${cell.publicDomain}`
      : ctx.shared.REHEARSAL_APP_URL
  const database = postgres('Postgres', { region: cell.serviceRegion })
  const cacheRedis = redis('Cache Redis', { region: cell.serviceRegion })
  const queueRedis = redis('Queue Redis', { region: cell.serviceRegion })
  // ADR-0050: provider material cannot use Railway's persistence-oriented
  // managed Redis template. This digest-promoted service has no volume or
  // public TCP proxy and boots TLS/non-default-ACL/non-persistent Redis from
  // the same signed candidate as the application services.
  const providerRedis = service('google-provider-redis', {
    source: railwayServiceSource(sourceInput, 'google-provider-redis'),
    deploy: servingDeploy(cell.serviceRegion, 30),
    env: {
      PROVIDER_EPHEMERAL_REDIS_URL: ctx.shared.PROVIDER_EPHEMERAL_REDIS_URL,
      PROVIDER_REDIS_TLS_CA_PEM: ctx.shared.PROVIDER_REDIS_TLS_CA_PEM,
      PROVIDER_REDIS_TLS_CERT_PEM: ctx.shared.PROVIDER_REDIS_TLS_CERT_PEM,
      PROVIDER_REDIS_TLS_KEY_PEM: ctx.shared.PROVIDER_REDIS_TLS_KEY_PEM,
      ...releaseControlledVariables(),
    },
  })
  const objectStore = bucket('object-store', { region: cell.bucketRegion })

  const applicationInfrastructure = {
    NODE_ENV: 'production',
    DATABASE_URL: database.env.DATABASE_URL,
    REDIS_URL: cacheRedis.env.REDIS_URL,
    QUEUE_REDIS_URL: queueRedis.env.REDIS_URL,
    // Provider Content/authorization storage is private TLS with a dedicated
    // non-default ACL identity. The shared URL is environment-scoped and
    // names only google-provider-redis.railway.internal:6380.
    PROVIDER_EPHEMERAL_REDIS_URL: ctx.shared.PROVIDER_EPHEMERAL_REDIS_URL,
    PROVIDER_EPHEMERAL_REDIS_CA_PEM: ctx.shared.PROVIDER_REDIS_TLS_CA_PEM,
    PROCESSING_CELL: cell.cellId,
    GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'production-fixed',
    AWS_S3_ACCESS_KEY: ref(objectStore, 'ACCESS_KEY_ID'),
    AWS_S3_SECRET_ACCESS_KEY: ref(objectStore, 'SECRET_ACCESS_KEY'),
    AWS_S3_BUCKET_NAME: ref(objectStore, 'BUCKET'),
    AWS_S3_REGION: ref(objectStore, 'REGION'),
    S3_INTERNAL_ENDPOINT: ref(objectStore, 'ENDPOINT'),
    S3_PRESIGN_ENDPOINT: ref(objectStore, 'ENDPOINT'),
    S3_FORCE_PATH_STYLE: 'false',
  }

  // First-rollout bootstrap and every later schema-only release use the exact
  // signed web image selected for this service in the staged source map. The
  // process exits after convergence and Railway retains a successful one-shot
  // deployment as SUCCESS.
  const schemaMigrator = service('schema-migrator', {
    source: railwayServiceSource(sourceInput, 'schema-migrator'),
    deploy: {
      numReplicas: 1,
      restartPolicyType: 'NEVER',
      region: cell.serviceRegion,
      startCommand: 'node dist-worker/migrate-deploy.js',
    },
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: database.env.DATABASE_URL,
      PROCESSING_CELL: cell.cellId,
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: deploymentProfile,
      BETTER_AUTH_SECRET: ctx.shared.BETTER_AUTH_SECRET,
      REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS:
        ctx.shared.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS,
    },
  })

  const web = service('web', {
    source: railwayServiceSource(sourceInput, 'web'),
    deploy: {
      ...servingDeploy(cell.serviceRegion, 30),
      preDeployCommand: ['node dist-worker/migrate-deploy.js'],
      // Promotion must not advance to worker/effect services until the serving
      // tier proves DB, queue Redis, migration, and policy readiness.
      healthcheckPath: '/api/health/ready',
      healthcheckTimeout: 30,
    },
    // Railway configuration can retain an existing custom domain, but the CLI
    // deliberately refuses to register one while creating a new service. The
    // one-time source-less foundation therefore omits the hostname. Operations
    // registers it through the exact-target domain ceremony before any
    // promotion; every promotion graph then declares and retains it here.
    ...(deploymentProfile === 'production' && sourceInput.stage === 'promotion'
      ? { domains: [cell.publicDomain] }
      : {}),
    env: {
      ...sharedVariables(ctx, APPLICATION_SHARED_VARIABLES),
      ...applicationInfrastructure,
      ...appTlsVariables(ctx, 'WEB'),
      ...releaseControlledVariables(),
      REPKEY_RAILWAY_DEPLOYMENT_PROFILE: deploymentProfile,
      BETTER_AUTH_URL: applicationUrl,
    },
  })

  const worker = service('worker', {
    source: railwayServiceSource(sourceInput, 'worker'),
    deploy: servingDeploy(cell.serviceRegion, 30),
    env: {
      ...sharedVariables(ctx, APPLICATION_SHARED_VARIABLES),
      ...sharedVariables(ctx, WORKER_ONLY_VARIABLES),
      ...applicationInfrastructure,
      ...appTlsVariables(ctx, 'WORKER'),
      ...releaseControlledVariables(),
      BETTER_AUTH_URL: applicationUrl,
    },
  })

  const googleAdmission = service('google-execution-admission', {
    source: railwayServiceSource(sourceInput, 'google-execution-admission'),
    deploy: sidecarDeploy(cell.serviceRegion, 30),
    env: {
      ...sidecarOperationalVariables(ctx, cell.cellId, '0.0.0.0'),
      DATABASE_URL: ctx.shared.GOOGLE_ADMISSION_DATABASE_URL,
      GOOGLE_ADMISSION_DATABASE_CA_B64: ctx.shared.GOOGLE_ADMISSION_DATABASE_CA_B64,
      REDIS_URL: ctx.shared.PROVIDER_EPHEMERAL_REDIS_URL,
      PROVIDER_REDIS_TLS_CA_PEM: ctx.shared.PROVIDER_REDIS_TLS_CA_PEM,
      GOOGLE_EGRESS_GATEWAY_IDENTITY: 'spiffe://repkey.internal/google-egress-gateway',
      GOOGLE_ADMISSION_GRANT_HMAC_KEYS: ctx.shared.GOOGLE_ADMISSION_GRANT_HMAC_KEYS,
      GOOGLE_INTERNAL_MTLS_CA_B64: ctx.shared.GOOGLE_INTERNAL_MTLS_CA_B64,
      GOOGLE_INTERNAL_MTLS_CERT_B64: ctx.shared.GOOGLE_ADMISSION_MTLS_CERT_B64,
      GOOGLE_INTERNAL_MTLS_KEY_B64: ctx.shared.GOOGLE_ADMISSION_MTLS_KEY_B64,
      ...releaseControlledVariables(),
    },
  })

  const googleGateway = service('google-egress-gateway', {
    source: railwayServiceSource(sourceInput, 'google-egress-gateway'),
    deploy: {
      ...sidecarDeploy(cell.serviceRegion, 30),
      startCommand: 'node dist-google-egress-gateway/index.js',
    },
    env: {
      ...sidecarOperationalVariables(ctx, cell.cellId, '0.0.0.0'),
      GOOGLE_EXECUTION_ADMISSION_ORIGIN:
        'https://google-execution-admission.railway.internal:8443',
      GOOGLE_EXECUTION_ADMISSION_SERVER_NAME: 'google-execution-admission',
      GOOGLE_EGRESS_GATEWAY_IDENTITY: 'spiffe://repkey.internal/google-egress-gateway',
      GOOGLE_EGRESS_ALLOWED_CALLER_IDENTITIES:
        'spiffe://repkey.internal/repkey-web,spiffe://repkey.internal/repkey-worker',
      GOOGLE_PROVIDER_ROUTE_PROFILE: 'production',
      GOOGLE_ADMISSION_GRANT_HMAC_KEYS: ctx.shared.GOOGLE_ADMISSION_GRANT_HMAC_KEYS,
      GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: ctx.shared.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS,
      GOOGLE_INTERNAL_MTLS_CA_B64: ctx.shared.GOOGLE_INTERNAL_MTLS_CA_B64,
      GOOGLE_INTERNAL_MTLS_CERT_B64: ctx.shared.GOOGLE_GATEWAY_MTLS_CERT_B64,
      GOOGLE_INTERNAL_MTLS_KEY_B64: ctx.shared.GOOGLE_GATEWAY_MTLS_KEY_B64,
      ...releaseControlledVariables(),
    },
  })

  const aiAdmission = service('ai-execution-admission', {
    source: railwayServiceSource(sourceInput, 'ai-execution-admission'),
    deploy: sidecarDeploy(cell.serviceRegion, 130),
    env: {
      ...sharedVariables(ctx, AI_ADMISSION_SHARED_VARIABLES),
      ...sidecarOperationalVariables(ctx, cell.cellId, '::'),
      AI_KEY_INVENTORY_PROFILE: ctx.shared.AI_KEY_INVENTORY_PROFILE,
      AI_INTERNAL_MTLS_CA_B64: ctx.shared.AI_INTERNAL_MTLS_CA_B64,
      AI_INTERNAL_MTLS_CERT_B64: ctx.shared.AI_ADMISSION_MTLS_CERT_B64,
      AI_INTERNAL_MTLS_KEY_B64: ctx.shared.AI_ADMISSION_MTLS_KEY_B64,
      ...releaseControlledVariables(),
    },
  })

  const aiGateway = service('ai-egress-gateway', {
    source: railwayServiceSource(sourceInput, 'ai-egress-gateway'),
    deploy: {
      ...sidecarDeploy(cell.serviceRegion, 130),
      startCommand: 'node dist-ai-egress-gateway/index.js',
    },
    env: {
      ...sharedVariables(ctx, AI_GATEWAY_SHARED_VARIABLES),
      ...sidecarOperationalVariables(ctx, cell.cellId, '::'),
      AI_KEY_INVENTORY_PROFILE: ctx.shared.AI_KEY_INVENTORY_PROFILE,
      AI_EXECUTION_ADMISSION_ORIGIN:
        'https://ai-execution-admission.railway.internal:8443',
      AI_INTERNAL_MTLS_CA_B64: ctx.shared.AI_INTERNAL_MTLS_CA_B64,
      AI_INTERNAL_MTLS_CERT_B64: ctx.shared.AI_GATEWAY_MTLS_CERT_B64,
      AI_INTERNAL_MTLS_KEY_B64: ctx.shared.AI_GATEWAY_MTLS_KEY_B64,
      ...releaseControlledVariables(),
    },
  })

  return project(projectName, {
    resources: [
      ...group('Application', [schemaMigrator, web, worker], { color: '#2563EB' }),
      ...group('Regional data', [database, cacheRedis, queueRedis, objectStore], {
        color: '#059669',
      }),
      ...group('Google boundary', [providerRedis, googleAdmission, googleGateway], {
        color: '#D97706',
      }),
      ...group('AI boundary', [aiAdmission, aiGateway], { color: '#7C3AED' }),
    ],
  })
}

export default defineRailway((ctx) =>
  buildRailwayProject(
    createRailwayContext(ctx),
    process.env.REPKEY_RAILWAY_CELL_ENVIRONMENT,
    process.env.REPKEY_RAILWAY_DEPLOYMENT_PROFILE,
    undefined,
    process.env[REPKEY_RAILWAY_PROJECT_NAME_ENV],
  ),
)
