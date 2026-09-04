import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_GATEWAY_BUILD_ATTESTATION_DIGEST } from '../../src/shared/ai-gateway-build-attestation'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from '../../src/shared/ai-openai-provider-profile'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '../../src/shared/ai-operation-profiles'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import {
  AI_CANARY_REQUIRED_ENVIRONMENT_NAMES,
  AI_EGRESS_PROBE_REQUIRED_ENVIRONMENT_NAMES,
  AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES,
  assertAiCanaryRequiredEnvironment,
  assertAiGatewayEnvironmentIsIsolated,
  assertAiGatewayRequiredEnvironment,
  assertAiGatewayRuntimeKeyInventory,
  assertRuntimeEgressProbeEnvironmentIsIsolated,
} from './environment'

const gatewayEnvironment = (): Record<string, string> => ({
  ...Object.fromEntries(
    AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, 'masked']),
  ),
  HOST: '::',
  PORT: '8080',
  INTERNAL_MTLS_PORT: '8443',
  PROCESSING_CELL: 'us',
  RELEASE_SHA: 'a'.repeat(40),
  AI_KEY_INVENTORY_PROFILE: 'production-v1',
  AI_EXECUTION_ADMISSION_ORIGIN: 'https://ai-execution-admission.railway.internal:8443',
  AI_REQUEST_BINDING_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.requestBinding.keyringGeneration,
  ),
  AI_SAFETY_IDENTIFIER_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.safetyIdentifier.keyringGeneration,
  ),
  AI_ADMISSION_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.keyringGeneration,
  ),
  AI_PROVENANCE_ED25519_KID: AI_GATEWAY_KEY_INVENTORY_V1.provenance.activeKid,
  AI_PROVENANCE_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.provenance.keyringGeneration,
  ),
  AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
  AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST: AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest,
  AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST: AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  AI_GATEWAY_BUILD_ATTESTATION_DIGEST,
})

function composeEnvironmentNames(service: string, nextService: string): string[] {
  const source = readFileSync(resolve(process.cwd(), 'compose.local.yml'), 'utf8')
  const block = source.slice(
    source.indexOf(`  ${service}:`),
    source.indexOf(`  ${nextService}:`),
  )
  const environment = block.slice(block.indexOf('    environment:'))
  return [...environment.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gmu)].map(
    (match) => match[1] ?? '',
  )
}

describe('AI gateway startup isolation', () => {
  it('documents gateway-only secrets and application-to-gateway placement', () => {
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8')
    for (const name of AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES) {
      expect(example).toContain(`# ${name}=`)
    }
    for (const name of [
      'AI_EGRESS_GATEWAY_ORIGIN',
      'AI_EGRESS_GATEWAY_SERVER_NAME',
      'AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON',
    ]) {
      expect(example).toContain(`# ${name}=`)
    }
  })

  it.each([
    'DATABASE_URL',
    'AI_CONTROL_DATABASE_URL',
    'APP_REDIS_URL',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
    'AI_SUBJECT_HMAC_KEYS',
    'PGPASSWORD',
    'POSTGRES_PASSWORD',
    'AWS_SECRET_ACCESS_KEY',
    'RESEND_API_KEY',
    'RAILWAY_TOKEN',
    'UNKNOWN_FLAG',
    'HTTP_PROXY',
    'OPENAI_BASE_URL',
    'openai_api_key',
  ])('rejects every unowned or noncanonical %s', (name) => {
    expect(() => assertAiGatewayEnvironmentIsIsolated({ [name]: '' })).toThrow(name)
  })

  it('rejects case-insensitive duplicate aliases', () => {
    expect(() =>
      assertAiGatewayEnvironmentIsIsolated({
        OPENAI_API_KEY: 'one',
        openai_api_key: 'two',
      }),
    ).toThrow('openai_api_key')
  })

  it('requires the exact release, deployment, runtime, and build evidence', () => {
    const environment = gatewayEnvironment()
    expect(() => assertAiGatewayRequiredEnvironment(environment)).not.toThrow()
    for (const [name, message] of [
      [
        'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
        'AI gateway AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION is stale: environment has 0, this build expects ',
      ],
      [
        'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
        'AI gateway AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST is stale: environment has 0, this build expects ',
      ],
      [
        'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
        'AI gateway AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST is stale: environment has 0, this build expects ',
      ],
      [
        'AI_GATEWAY_BUILD_ATTESTATION_DIGEST',
        'AI gateway AI_GATEWAY_BUILD_ATTESTATION_DIGEST is stale: environment has 0, this build expects ',
      ],
      [
        'AI_REQUEST_BINDING_KEYRING_GENERATION',
        'AI gateway request-binding keyring generation is invalid',
      ],
      [
        'AI_ADMISSION_KEYRING_GENERATION',
        'AI gateway admission keyring generation is invalid',
      ],
      ['RELEASE_SHA', 'AI gateway release SHA is invalid'],
    ] as const) {
      expect(() =>
        assertAiGatewayRequiredEnvironment({
          ...environment,
          [name]: '0',
        }),
      ).toThrow(message)
    }
  })
  it('defaults missing gateway host, ports, cell, and profile metadata', () => {
    const environment = gatewayEnvironment()
    delete environment.HOST
    delete environment.PORT
    delete environment.INTERNAL_MTLS_PORT
    delete environment.PROCESSING_CELL
    delete environment.AI_KEY_INVENTORY_PROFILE
    expect(() => assertAiGatewayRequiredEnvironment(environment)).not.toThrow()
  })
  it.each([
    ['HOST', '0.0.0.0', 'AI gateway bind address is invalid'],
    ['HOST', '::1', 'AI gateway bind address is invalid'],
    ['PORT', '8444', 'AI gateway bind address is invalid'],
    ['PORT', '443', 'AI gateway bind address is invalid'],
    ['INTERNAL_MTLS_PORT', '8080', 'AI gateway bind address is invalid'],
    ['INTERNAL_MTLS_PORT', '8444', 'AI gateway bind address is invalid'],
    [
      'AI_EXECUTION_ADMISSION_ORIGIN',
      'https://ai-execution-admission:8443',
      'AI gateway admission origin is invalid',
    ],
    [
      'AI_EXECUTION_ADMISSION_ORIGIN',
      'https://other.railway.internal:8443',
      'AI gateway admission origin is invalid',
    ],
  ])('rejects mutated private bind/admission route %s=%s', (name, value, message) => {
    expect(() =>
      assertAiGatewayRequiredEnvironment({ ...gatewayEnvironment(), [name]: value }),
    ).toThrow(message)
  })

  it('accepts monitoring variables and refuses a dormant beta cell', () => {
    expect(() =>
      assertAiGatewayRequiredEnvironment({
        ...gatewayEnvironment(),
        SENTRY_DSN: 'https://public@ingest.us.sentry.io/1',
        SENTRY_TRACES_SAMPLE_RATE: '0.1',
      }),
    ).not.toThrow()
    expect(() =>
      assertAiGatewayRequiredEnvironment({
        ...gatewayEnvironment(),
        PROCESSING_CELL: 'global',
      }),
    ).toThrow('AI gateway processing cell is invalid')
  })

  it('accepts the documented Node/Railway deployment metadata inventory only', () => {
    const environment = {
      ...gatewayEnvironment(),
      HOME: '/home/node',
      HOSTNAME: 'container',
      NODE_ENV: 'production',
      NODE_VERSION: '22.23.2',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      PWD: '/app',
      SHLVL: '1',
      YARN_VERSION: '1.22.22',
      RAILWAY_BETA_ENABLE_RUNTIME_V2: '1',
      RAILWAY_DEPLOYMENT_ID: 'deployment',
      RAILWAY_ENVIRONMENT_ID: 'environment',
      RAILWAY_ENVIRONMENT_NAME: 'cell-us',
      RAILWAY_GIT_AUTHOR: 'owner',
      RAILWAY_GIT_BRANCH: 'main',
      RAILWAY_GIT_COMMIT_MESSAGE: 'release',
      RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40),
      RAILWAY_GIT_REPO_NAME: 'rep-key',
      RAILWAY_GIT_REPO_OWNER: 'owner',
      RAILWAY_PRIVATE_DOMAIN: 'ai-egress-gateway.railway.internal',
      RAILWAY_PROJECT_ID: 'project',
      RAILWAY_PROJECT_NAME: PRODUCTION_RAILWAY_PROJECT_NAME,
      RAILWAY_REPLICA_ID: 'replica',
      RAILWAY_REPLICA_REGION: 'us-west2',
      RAILWAY_SERVICE_ID: 'service',
      RAILWAY_SERVICE_NAME: 'ai-egress-gateway',
      RAILWAY_SNAPSHOT_ID: 'snapshot',
    }
    expect(() => assertAiGatewayRequiredEnvironment(environment)).not.toThrow()
    for (const name of ['DATABASE_URL', 'AI_CONTROL_DATABASE_URL', 'GOOGLE_API_KEY']) {
      expect(() =>
        assertAiGatewayRequiredEnvironment({ ...environment, [name]: 'secret' }),
      ).toThrow(name)
    }
  })

  it.each([
    ['oversize', 'a'.repeat(4_097)],
    ['newline', 'secret-sentinel\nsuffix'],
    ['control', 'secret-sentinel\u0000suffix'],
    ['space', 'secret sentinel'],
    ['non-ascii', 'secret-sentinel\u00e9'],
  ])('rejects an invalid OpenAI API key value: %s', (_caseName, key) => {
    const invoke = () =>
      assertAiGatewayRequiredEnvironment({
        ...gatewayEnvironment(),
        OPENAI_API_KEY: key,
      })
    expect(invoke).toThrow('AI gateway OpenAI API key is invalid')
    try {
      invoke()
    } catch (error) {
      expect(String(error)).not.toContain('secret-sentinel')
    }
  })

  it('accepts the maximum bounded printable ASCII OpenAI API key', () => {
    expect(() =>
      assertAiGatewayRequiredEnvironment({
        ...gatewayEnvironment(),
        OPENAI_API_KEY: 'a'.repeat(4_096),
      }),
    ).not.toThrow()
  })

  it.each([
    [
      'provenance malformed kid',
      { AI_PROVENANCE_ED25519_KID: 'BAD KID' },
      'AI gateway provenance active key ID is invalid',
    ],
    [
      'provenance unknown kid',
      { AI_PROVENANCE_ED25519_KID: 'provenance-v2' },
      'AI gateway provenance active key ID is invalid',
    ],
    [
      'provenance stale generation',
      { AI_PROVENANCE_KEYRING_GENERATION: '0' },
      'AI gateway provenance keyring generation is invalid',
    ],
    [
      'safety stale generation',
      { AI_SAFETY_IDENTIFIER_KEYRING_GENERATION: '0' },
      'AI gateway safety identifier keyring generation is invalid',
    ],
    [
      'request-binding stale generation',
      { AI_REQUEST_BINDING_KEYRING_GENERATION: '0' },
      'AI gateway request-binding keyring generation is invalid',
    ],
  ])(
    'rejects an invalid active gateway key inventory at boot: %s',
    (_caseName, mutation, message) => {
      expect(() =>
        assertAiGatewayRequiredEnvironment({ ...gatewayEnvironment(), ...mutation }),
      ).toThrow(message)
    },
  )

  it.each([
    ['malformed', 'BAD VERSION'],
    ['unknown', 'safety-v2'],
  ])('rejects an invalid loaded safety-key version at boot: %s', (_caseName, version) => {
    expect(() =>
      assertAiGatewayRuntimeKeyInventory({
        safetyIdentifierVersion: version,
        provenanceKid: AI_GATEWAY_KEY_INVENTORY_V1.provenance.activeKid,
      }),
    ).toThrow('AI gateway safety identifier active key version is invalid')
  })

  it('keeps the compose gateway inventory equal to its owned required names', () => {
    expect(composeEnvironmentNames('ai-egress-gateway', 'seed').sort()).toEqual(
      ['NODE_ENV', ...AI_GATEWAY_REQUIRED_ENVIRONMENT_NAMES].sort(),
    )
  })

  it('gives the runtime probe only its three evidence values and runtime metadata', () => {
    const probe = {
      AI_EGRESS_PROBE_RELEASE_SHA: 'a'.repeat(40),
      AI_EGRESS_PROBE_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
      AI_EGRESS_PROBE_REGION: 'us-west1',
      PATH: '/usr/bin',
      PORT: '8080',
    }
    expect(() => assertRuntimeEgressProbeEnvironmentIsIsolated(probe)).not.toThrow()
    expect(AI_EGRESS_PROBE_REQUIRED_ENVIRONMENT_NAMES).toEqual([
      'AI_EGRESS_PROBE_RELEASE_SHA',
      'AI_EGRESS_PROBE_IMAGE_DIGEST',
      'AI_EGRESS_PROBE_REGION',
    ])
    for (const name of [
      'OPENAI_API_KEY',
      'AI_INTERNAL_MTLS_KEY_B64',
      'DATABASE_URL',
      'AWS_SECRET_ACCESS_KEY',
      'SENTRY_DSN',
      'RAILWAY_TOKEN',
      'UNKNOWN_FLAG',
      'openai_api_key',
    ]) {
      expect(() =>
        assertRuntimeEgressProbeEnvironmentIsIsolated({ ...probe, [name]: '' }),
      ).toThrow(name)
    }
  })

  it('allows an unused Railway PORT for the one-shot canary', () => {
    const gateway = gatewayEnvironment()
    const canary = Object.fromEntries(
      AI_CANARY_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, gateway[name]]),
    )
    expect(() =>
      assertAiCanaryRequiredEnvironment({ ...canary, PORT: '8080' }),
    ).not.toThrow()
    expect(() => assertAiCanaryRequiredEnvironment({ ...canary, PORT: '0' })).toThrow(
      'AI canary Railway PORT is invalid',
    )
  })
})
