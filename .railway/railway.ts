import {
  bucket,
  defineRailway,
  group,
  postgres,
  project,
  redis,
  ref,
  service,
  type ProjectDefinition,
  type RailwayContext,
  type VariableValue,
} from 'railway/iac'
import { resolveCellTopology } from './cell-topology'

const APPLICATION_SHARED_VARIABLES = [
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'EMAIL_FROM',
  'OPS_METRICS_TOKEN',
  'RELEASE_SHA',
  'RELEASE_MANIFEST_SHA256',
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
  'RELEASE_SHA',
  'RELEASE_MANIFEST_SHA256',
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
  'RELEASE_SHA',
  'RELEASE_MANIFEST_SHA256',
] as const

function sharedVariables(
  ctx: RailwayContext,
  names: readonly string[],
): Record<string, VariableValue> {
  return Object.fromEntries(names.map((name) => [name, ctx.shared[name]]))
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

// REG-03 deliberately leaves application source/build ownership out of this
// infrastructure graph. `release:beta` connects a signed registry digest after
// the graph provisions each empty service and owns its deploy, networking,
// variables, and resource references. A Dockerfile build here would let a later
// `config apply` silently replace promoted bytes.

/** Exported for offline topology/allowlist tests; the CLI consumes the default. */
export function buildRailwayProject(ctx: RailwayContext): ProjectDefinition {
  const cell = resolveCellTopology(ctx.environmentName ?? ctx.environment)
  const database = postgres('Postgres', { region: cell.serviceRegion })
  const queueRedis = redis('Redis', { region: cell.serviceRegion })
  const providerRedis = redis('google-provider-redis', {
    region: cell.serviceRegion,
  })
  const objectStore = bucket('object-store', { region: cell.bucketRegion })

  const applicationInfrastructure = {
    NODE_ENV: 'production',
    DATABASE_URL: database.env.DATABASE_URL,
    REDIS_URL: queueRedis.env.REDIS_URL,
    // Provider Content/authorization storage is a separate TLS connection.
    PROVIDER_EPHEMERAL_REDIS_URL: providerRedis.env.REDIS_PUBLIC_URL,
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

  const web = service('web', {
    deploy: {
      ...servingDeploy(cell.serviceRegion, 30),
      preDeployCommand: ['node dist-worker/migrate-deploy.js'],
      healthcheckPath: '/api/health/started',
      healthcheckTimeout: 30,
    },
    domains: [cell.publicDomain],
    env: {
      ...sharedVariables(ctx, APPLICATION_SHARED_VARIABLES),
      ...applicationInfrastructure,
      ...appTlsVariables(ctx, 'WEB'),
      BETTER_AUTH_URL: `https://${cell.publicDomain}`,
    },
  })

  const worker = service('worker', {
    deploy: servingDeploy(cell.serviceRegion, 30),
    env: {
      ...sharedVariables(ctx, APPLICATION_SHARED_VARIABLES),
      ...sharedVariables(ctx, WORKER_ONLY_VARIABLES),
      ...applicationInfrastructure,
      ...appTlsVariables(ctx, 'WORKER'),
      BETTER_AUTH_URL: `https://${cell.publicDomain}`,
    },
  })

  const googleAdmission = service('google-execution-admission', {
    deploy: servingDeploy(cell.serviceRegion, 30),
    env: {
      HOST: '0.0.0.0',
      PORT: '8443',
      DATABASE_URL: ctx.shared.GOOGLE_ADMISSION_DATABASE_URL,
      GOOGLE_ADMISSION_DATABASE_CA_B64: ctx.shared.GOOGLE_ADMISSION_DATABASE_CA_B64,
      REDIS_URL: providerRedis.env.REDIS_PUBLIC_URL,
      GOOGLE_EGRESS_GATEWAY_IDENTITY: 'spiffe://repkey.internal/google-egress-gateway',
      GOOGLE_ADMISSION_GRANT_HMAC_KEYS: ctx.shared.GOOGLE_ADMISSION_GRANT_HMAC_KEYS,
      GOOGLE_INTERNAL_MTLS_CA_B64: ctx.shared.GOOGLE_INTERNAL_MTLS_CA_B64,
      GOOGLE_INTERNAL_MTLS_CERT_B64: ctx.shared.GOOGLE_ADMISSION_MTLS_CERT_B64,
      GOOGLE_INTERNAL_MTLS_KEY_B64: ctx.shared.GOOGLE_ADMISSION_MTLS_KEY_B64,
      RELEASE_SHA: ctx.shared.RELEASE_SHA,
      RELEASE_MANIFEST_SHA256: ctx.shared.RELEASE_MANIFEST_SHA256,
    },
  })

  const googleGateway = service('google-egress-gateway', {
    deploy: {
      ...servingDeploy(cell.serviceRegion, 30),
      startCommand: 'node dist-google-egress-gateway/index.js',
    },
    env: {
      HOST: '0.0.0.0',
      PORT: '8443',
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
      RELEASE_SHA: ctx.shared.RELEASE_SHA,
      RELEASE_MANIFEST_SHA256: ctx.shared.RELEASE_MANIFEST_SHA256,
    },
  })

  const aiAdmission = service('ai-execution-admission', {
    deploy: servingDeploy(cell.serviceRegion, 130),
    env: {
      ...sharedVariables(ctx, AI_ADMISSION_SHARED_VARIABLES),
      HOST: '::',
      PORT: '8443',
      AI_KEY_INVENTORY_PROFILE: ctx.shared.AI_KEY_INVENTORY_PROFILE,
      AI_INTERNAL_MTLS_CA_B64: ctx.shared.AI_INTERNAL_MTLS_CA_B64,
      AI_INTERNAL_MTLS_CERT_B64: ctx.shared.AI_ADMISSION_MTLS_CERT_B64,
      AI_INTERNAL_MTLS_KEY_B64: ctx.shared.AI_ADMISSION_MTLS_KEY_B64,
    },
  })

  const aiGateway = service('ai-egress-gateway', {
    deploy: {
      ...servingDeploy(cell.serviceRegion, 130),
      startCommand: 'node dist-ai-egress-gateway/index.js',
    },
    env: {
      ...sharedVariables(ctx, AI_GATEWAY_SHARED_VARIABLES),
      HOST: '::',
      PORT: '8443',
      AI_KEY_INVENTORY_PROFILE: ctx.shared.AI_KEY_INVENTORY_PROFILE,
      AI_EXECUTION_ADMISSION_ORIGIN:
        'https://ai-execution-admission.railway.internal:8443',
      AI_INTERNAL_MTLS_CA_B64: ctx.shared.AI_INTERNAL_MTLS_CA_B64,
      AI_INTERNAL_MTLS_CERT_B64: ctx.shared.AI_GATEWAY_MTLS_CERT_B64,
      AI_INTERNAL_MTLS_KEY_B64: ctx.shared.AI_GATEWAY_MTLS_KEY_B64,
    },
  })

  return project(ctx.projectName ?? 'repkey-data-cells', {
    resources: [
      ...group('Application', [web, worker], { color: '#2563EB' }),
      ...group('Regional data', [database, queueRedis, objectStore], {
        color: '#059669',
      }),
      ...group('Google boundary', [providerRedis, googleAdmission, googleGateway], {
        color: '#D97706',
      }),
      ...group('AI boundary', [aiAdmission, aiGateway], { color: '#7C3AED' }),
    ],
  })
}

export default defineRailway((ctx) => buildRailwayProject(ctx))
