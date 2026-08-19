import { AI_GATEWAY_KEY_INVENTORY_V1 } from '../../src/shared/ai-openai-provider-profile'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '../../src/shared/ai-operation-profiles'
import { AI_GATEWAY_BUILD_ATTESTATION_DIGEST } from '../../src/shared/ai-gateway-build-attestation'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import { resolveAiGatewayRuntimeKeyInventory } from '../../src/shared/ai-gateway-key-inventory'
const RUNTIME_METADATA_NAMES = Object.freeze([
  '__CF_USER_TEXT_ENCODING',
  'HOME',
  'HOSTNAME',
  'NODE_ENV',
  'NODE_VERSION',
  'PATH',
  'PORT',
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
] as const)

const GATEWAY_OWNED_NAMES = Object.freeze([
  'AI_KEY_INVENTORY_PROFILE',
  'HOST',
  'OPENAI_API_KEY',
  'AI_EXECUTION_ADMISSION_ORIGIN',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
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
] as const)
const GATEWAY_REQUIRED_NAMES = Object.freeze([...GATEWAY_OWNED_NAMES, 'PORT'] as const)
export const AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES = GATEWAY_REQUIRED_NAMES

const GATEWAY_ALLOWED = new Set<string>([
  ...RUNTIME_METADATA_NAMES,
  ...GATEWAY_OWNED_NAMES,
])
const PROBE_OWNED_NAMES = Object.freeze([
  'AI_EGRESS_PROBE_RELEASE_SHA',
  'AI_EGRESS_PROBE_IMAGE_DIGEST',
  'AI_EGRESS_PROBE_REGION',
] as const)
export const AI_EGRESS_PROBE_REQUIRED_ENVIRONMENT_NAMES = PROBE_OWNED_NAMES
const PROBE_ALLOWED = new Set<string>([...RUNTIME_METADATA_NAMES, ...PROBE_OWNED_NAMES])
const CANARY_OWNED_NAMES = Object.freeze([
  'AI_KEY_INVENTORY_PROFILE',
  'OPENAI_API_KEY',
  'AI_EXECUTION_ADMISSION_ORIGIN',
  'AI_INTERNAL_MTLS_CA_B64',
  'AI_INTERNAL_MTLS_CERT_B64',
  'AI_INTERNAL_MTLS_KEY_B64',
  'AI_REQUEST_BINDING_HMAC_KEYS',
  'AI_REQUEST_BINDING_KEYRING_GENERATION',
  'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
  'AI_ADMISSION_KEYRING_GENERATION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
  'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
  'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
  'AI_GATEWAY_BUILD_ATTESTATION_DIGEST',
  'RELEASE_SHA',
] as const)
export const AI_CANARY_REQUIRED_ENVIRONMENT_NAMES = CANARY_OWNED_NAMES
const CANARY_ALLOWED = new Set<string>([...RUNTIME_METADATA_NAMES, ...CANARY_OWNED_NAMES])

const AI_GATEWAY_RUNTIME_DEFAULT_HOST = '::'
const AI_GATEWAY_RUNTIME_DEFAULT_PORT = '8443'
const AI_GATEWAY_RUNTIME_DEFAULT_KEY_INVENTORY_PROFILE = 'production-v1'

function normalizeAiGatewayRuntimeDefaults(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const host = environment.HOST ?? AI_GATEWAY_RUNTIME_DEFAULT_HOST
  const port = environment.PORT ?? AI_GATEWAY_RUNTIME_DEFAULT_PORT
  const aiKeyInventoryProfile =
    environment.AI_KEY_INVENTORY_PROFILE ??
    AI_GATEWAY_RUNTIME_DEFAULT_KEY_INVENTORY_PROFILE

  return {
    ...environment,
    HOST: host,
    PORT: port,
    AI_KEY_INVENTORY_PROFILE: aiKeyInventoryProfile,
  } as Record<string, string>
}

function fail(service: 'gateway' | 'probe' | 'canary', name: string): never {
  throw new Error(`AI ${service} environment contains forbidden variable ${name}`)
}

function assertExactAllowlist(
  service: 'gateway' | 'probe' | 'canary',
  environment: Readonly<Record<string, string | undefined>>,
  allowed: ReadonlySet<string>,
): void {
  const canonicalNames = new Set<string>()
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const canonical = name.toUpperCase()
    if (name !== canonical || canonicalNames.has(canonical) || !allowed.has(name)) {
      fail(service, name)
    }
    canonicalNames.add(canonical)
  }
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]
  if (!value) throw new Error(`required AI gateway setting is missing: ${name}`)
  return value
}

function assertOpenAiApiKey(value: string): void {
  if (!/^[\x21-\x7e]{1,4096}$/u.test(value)) {
    throw new Error('AI gateway OpenAI API key is invalid')
  }
}

function assertOptionalRailwayPort(
  service: 'probe' | 'canary',
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const value = environment.PORT
  if (
    value !== undefined &&
    (!/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 65_535)
  ) {
    throw new Error(`AI ${service} Railway PORT is invalid`)
  }
}

export function assertAiGatewayRuntimeKeyInventory(
  input: Readonly<{
    safetyIdentifierVersion: string
    provenanceKid: string
  }>,
): void {
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/u.test(input.safetyIdentifierVersion) ||
    input.safetyIdentifierVersion !==
      AI_GATEWAY_KEY_INVENTORY_V1.safetyIdentifier.activeVersion
  ) {
    throw new Error('AI gateway safety identifier active key version is invalid')
  }
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/u.test(input.provenanceKid) ||
    input.provenanceKid !== AI_GATEWAY_KEY_INVENTORY_V1.provenance.activeKid
  ) {
    throw new Error('AI gateway provenance active key ID is invalid')
  }
}

export function assertAiGatewayEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  assertExactAllowlist('gateway', environment, GATEWAY_ALLOWED)
}

// A contract digest that rotates in code has to be rotated in the deployment
// environment too, and this boot check is the only place that coupling is
// visible. Naming the variable and the value the build expects turns a silent
// CRASHED deploy into a one-line fix. Digests are public contract identifiers,
// not secrets, so echoing them is safe — never widen this to key material.
function assertContractVariable(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  expected: string,
): void {
  const actual = required(environment, name)
  if (actual === expected) return
  throw new Error(
    `AI gateway ${name} is stale: environment has ${actual}, this build expects ` +
      `${expected}. Rotate it on ai-egress-gateway and ai-execution-admission, ` +
      `then redeploy.`,
  )
}

export function assertAiGatewayRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const normalizedEnvironment = normalizeAiGatewayRuntimeDefaults(environment)
  assertAiGatewayEnvironmentIsIsolated(normalizedEnvironment)
  resolveAiGatewayRuntimeKeyInventory(normalizedEnvironment)
  for (const name of GATEWAY_REQUIRED_NAMES) required(normalizedEnvironment, name)
  assertOpenAiApiKey(required(normalizedEnvironment, 'OPENAI_API_KEY'))
  if (
    required(normalizedEnvironment, 'AI_REQUEST_BINDING_KEYRING_GENERATION') !==
    String(AI_GATEWAY_KEY_INVENTORY_V1.requestBinding.keyringGeneration)
  ) {
    throw new Error('AI gateway request-binding keyring generation is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_SAFETY_IDENTIFIER_KEYRING_GENERATION') !==
    String(AI_GATEWAY_KEY_INVENTORY_V1.safetyIdentifier.keyringGeneration)
  ) {
    throw new Error('AI gateway safety identifier keyring generation is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_ADMISSION_KEYRING_GENERATION') !==
    String(AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.keyringGeneration)
  ) {
    throw new Error('AI gateway admission keyring generation is invalid')
  }
  assertAiGatewayRuntimeKeyInventory({
    safetyIdentifierVersion: AI_GATEWAY_KEY_INVENTORY_V1.safetyIdentifier.activeVersion,
    provenanceKid: required(normalizedEnvironment, 'AI_PROVENANCE_ED25519_KID'),
  })
  if (
    required(normalizedEnvironment, 'AI_PROVENANCE_KEYRING_GENERATION') !==
    String(AI_GATEWAY_KEY_INVENTORY_V1.provenance.keyringGeneration)
  ) {
    throw new Error('AI gateway provenance keyring generation is invalid')
  }
  assertContractVariable(
    normalizedEnvironment,
    'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
    AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
  )
  assertContractVariable(
    normalizedEnvironment,
    'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
    AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
  )
  assertContractVariable(
    normalizedEnvironment,
    'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
    AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  )
  assertContractVariable(
    normalizedEnvironment,
    'AI_GATEWAY_BUILD_ATTESTATION_DIGEST',
    AI_GATEWAY_BUILD_ATTESTATION_DIGEST,
  )
  if (!/^[0-9a-f]{40}$/u.test(required(normalizedEnvironment, 'RELEASE_SHA'))) {
    throw new Error('AI gateway release SHA is invalid')
  }
  if (
    required(normalizedEnvironment, 'HOST') !== '::' ||
    required(normalizedEnvironment, 'PORT') !== '8443'
  ) {
    throw new Error('AI gateway bind address is invalid')
  }
  if (
    required(normalizedEnvironment, 'AI_EXECUTION_ADMISSION_ORIGIN') !==
    'https://ai-execution-admission.railway.internal:8443'
  ) {
    throw new Error('AI gateway admission origin is invalid')
  }
}

export function assertAiCanaryRequiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  assertExactAllowlist('canary', environment, CANARY_ALLOWED)
  assertOptionalRailwayPort('canary', environment)
  resolveAiGatewayRuntimeKeyInventory(environment)
  for (const name of CANARY_OWNED_NAMES) required(environment, name)
  assertOpenAiApiKey(required(environment, 'OPENAI_API_KEY'))
  if (
    required(environment, 'AI_REQUEST_BINDING_KEYRING_GENERATION') !==
    String(AI_GATEWAY_KEY_INVENTORY_V1.requestBinding.keyringGeneration)
  ) {
    throw new Error('AI canary request-binding keyring generation is invalid')
  }
  if (
    required(environment, 'AI_EXECUTION_ADMISSION_ORIGIN') !==
      'https://ai-execution-admission.railway.internal:8443' ||
    required(environment, 'AI_ADMISSION_KEYRING_GENERATION') !==
      String(AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.keyringGeneration) ||
    required(environment, 'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION') !==
      AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion ||
    required(environment, 'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST') !==
      AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest ||
    required(environment, 'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST') !==
      AI_RUNTIME_CAPABILITIES_V1_DIGEST ||
    required(environment, 'AI_GATEWAY_BUILD_ATTESTATION_DIGEST') !==
      AI_GATEWAY_BUILD_ATTESTATION_DIGEST ||
    !/^[0-9a-f]{40}$/u.test(required(environment, 'RELEASE_SHA'))
  ) {
    throw new Error('AI canary environment profile is invalid')
  }
}

export function assertRuntimeEgressProbeEnvironmentIsIsolated(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  assertExactAllowlist('probe', environment, PROBE_ALLOWED)
  assertOptionalRailwayPort('probe', environment)
  for (const name of PROBE_OWNED_NAMES) {
    if (!environment[name]) {
      throw new Error(`required AI probe setting is missing: ${name}`)
    }
  }
}
