import {
  AI_GATEWAY_KEY_INVENTORY_V1,
  AI_PROVIDER_DEPLOYMENT_PROFILE_V1,
} from '../../src/shared/ai-openai-provider-profile'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import { resolveAiGatewayRuntimeKeyInventory } from '../../src/shared/ai-gateway-key-inventory'

const RUNTIME_METADATA_NAMES = Object.freeze([
  'HOME',
  'HOSTNAME',
  'NODE_ENV',
  'NODE_VERSION',
  'PATH',
  'PWD',
  'SHLVL',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'YARN_VERSION',
  'RAILWAY_BETA_ENABLE_RUNTIME_V2',
  'RAILWAY_DEPLOYMENT_ID',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_GIT_AUTHOR',
  'RAILWAY_GIT_BRANCH',
  'RAILWAY_GIT_COMMIT_MESSAGE',
  'RAILWAY_GIT_COMMIT_SHA',
  'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_REPO_OWNER',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_PROJECT_NAME',
  'RAILWAY_REPLICA_ID',
  'RAILWAY_REPLICA_REGION',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_SERVICE_GBP_SANDBOX_URL',
  'RAILWAY_SERVICE_MAIL_SANDBOX_URL',
  'RAILWAY_SERVICE_WEB_URL',
  'RAILWAY_SERVICE_NAME',
  'RAILWAY_SNAPSHOT_ID',
  'RELEASE_MANIFEST_SHA256',
] as const)

const ADMISSION_OWNED_NAMES = Object.freeze([
  'HOST',
  'AI_KEY_INVENTORY_PROFILE',
  'PORT',
  'INTERNAL_MTLS_PORT',
  'PROCESSING_CELL',
  'AI_CONTROL_DATABASE_URL',
  'AI_CONTROL_DATABASE_CA_B64',
  'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
  'AI_ADMISSION_ED25519_KID',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_REQUEST_BINDING_KEYRING_GENERATION',
  'AI_ADMISSION_KEYRING_GENERATION',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
  'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
  'RELEASE_SHA',
] as const)
export const AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES = ADMISSION_OWNED_NAMES

const OBSERVABILITY_NAMES = Object.freeze([
  'SENTRY_DSN',
  'SENTRY_TRACES_SAMPLE_RATE',
] as const)

const AI_ADMISSION_RUNTIME_DEFAULT_HOST = '::'
const AI_ADMISSION_RUNTIME_DEFAULT_PORT = '8080'
const AI_ADMISSION_RUNTIME_DEFAULT_MTLS_PORT = '8443'
const AI_ADMISSION_RUNTIME_DEFAULT_CELL = 'us'
const AI_ADMISSION_RUNTIME_DEFAULT_KEY_INVENTORY_PROFILE = 'production-v1'

function normalizeAiAdmissionRuntimeDefaults(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return {
    ...environment,
    HOST: environment.HOST ?? AI_ADMISSION_RUNTIME_DEFAULT_HOST,
    PORT: environment.PORT ?? AI_ADMISSION_RUNTIME_DEFAULT_PORT,
    INTERNAL_MTLS_PORT:
      environment.INTERNAL_MTLS_PORT ?? AI_ADMISSION_RUNTIME_DEFAULT_MTLS_PORT,
    PROCESSING_CELL: environment.PROCESSING_CELL ?? AI_ADMISSION_RUNTIME_DEFAULT_CELL,
    AI_KEY_INVENTORY_PROFILE:
      environment.AI_KEY_INVENTORY_PROFILE ??
      AI_ADMISSION_RUNTIME_DEFAULT_KEY_INVENTORY_PROFILE,
  } as Record<string, string>
}

const ADMISSION_ALLOWED = new Set<string>([
  ...RUNTIME_METADATA_NAMES,
  ...ADMISSION_OWNED_NAMES,
  ...OBSERVABILITY_NAMES,
])

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: (typeof ADMISSION_OWNED_NAMES)[number],
): string {
  const value = environment[name]
  if (!value) throw new Error(`required AI admission setting is missing: ${name}`)
  return value
}

export function assertAiAdmissionEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const canonicalNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const canonical = name.toUpperCase()
    if (
      name !== canonical ||
      canonicalNames.has(canonical) ||
      !ADMISSION_ALLOWED.has(name)
    ) {
      throw new Error(`AI admission environment contains forbidden variable ${name}`)
    }
    canonicalNames.add(canonical)
  }
}

export function assertAiAdmissionRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const normalizedEnvironment = normalizeAiAdmissionRuntimeDefaults(environment)
  assertAiAdmissionEnvironmentIsIsolated(normalizedEnvironment)
  resolveAiGatewayRuntimeKeyInventory(normalizedEnvironment)
  for (const name of ADMISSION_OWNED_NAMES) required(normalizedEnvironment, name)
  if (
    required(normalizedEnvironment, 'AI_REQUEST_BINDING_KEYRING_GENERATION') !==
      String(AI_GATEWAY_KEY_INVENTORY_V1.requestBinding.keyringGeneration) ||
    required(normalizedEnvironment, 'AI_ADMISSION_KEYRING_GENERATION') !==
      String(AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.keyringGeneration) ||
    required(normalizedEnvironment, 'AI_ADMISSION_ED25519_KID') !==
      AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.activeKid
  ) {
    throw new Error('AI admission key inventory is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION') !==
    AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion
  ) {
    throw new Error('AI admission deployment profile version is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST') !==
    AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileDigest
  ) {
    throw new Error('AI admission deployment profile digest is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST') !==
    AI_RUNTIME_CAPABILITIES_V1_DIGEST
  ) {
    throw new Error('AI admission runtime capability catalogue digest is invalid')
  }
  if (!/^[0-9a-f]{40}$/u.test(required(normalizedEnvironment, 'RELEASE_SHA'))) {
    throw new Error('AI admission release SHA is invalid')
  }
  if (
    required(normalizedEnvironment, 'HOST') !== '::' ||
    required(normalizedEnvironment, 'PORT') !== '8080' ||
    required(normalizedEnvironment, 'INTERNAL_MTLS_PORT') !== '8443'
  ) {
    throw new Error('AI admission bind address is invalid')
  }
  if (required(normalizedEnvironment, 'PROCESSING_CELL') !== 'us') {
    throw new Error('AI admission processing cell is invalid')
  }
}
