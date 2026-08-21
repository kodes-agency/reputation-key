import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AI_GATEWAY_KEY_INVENTORY_V1,
  AI_PROVIDER_DEPLOYMENT_PROFILE_V1,
} from '../../src/shared/ai-openai-provider-profile'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import {
  AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES,
  assertAiAdmissionEnvironmentIsIsolated,
  assertAiAdmissionRequiredEnvironment,
} from './environment'
import { loadEd25519PrivateKey } from './key-material'

const admissionEnvironment = (): Record<string, string> => ({
  ...Object.fromEntries(
    AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, 'masked']),
  ),
  HOST: '::',
  PORT: '8443',
  RELEASE_SHA: 'a'.repeat(40),
  AI_KEY_INVENTORY_PROFILE: 'production-v1',
  AI_REQUEST_BINDING_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.requestBinding.keyringGeneration,
  ),
  AI_ADMISSION_KEYRING_GENERATION: String(
    AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.keyringGeneration,
  ),
  AI_ADMISSION_ED25519_KID: AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.activeKid,
  AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION:
    AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion,
  AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST: AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileDigest,
  AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST: AI_RUNTIME_CAPABILITIES_V1_DIGEST,
})

function admissionComposeEnvironmentNames(): string[] {
  const source = readFileSync(resolve(process.cwd(), 'compose.local.yml'), 'utf8')
  const block = source.slice(
    source.indexOf('  ai-execution-admission:'),
    source.indexOf('  ai-egress-gateway:'),
  )
  const environment = block.slice(block.indexOf('    environment:'))
  return [...environment.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gmu)].map(
    (match) => match[1] ?? '',
  )
}

describe('AI admission startup isolation', () => {
  it.each([
    'OPENAI_API_KEY',
    'openai_api_key',
    'AI_PROVENANCE_ED25519_PRIVATE_KEY_B64',
    'AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON',
    'DATABASE_URL',
    'APP_REDIS_URL',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AI_DELETION_LEDGER_DATABASE_URL',
    'PGPASSWORD',
    'POSTGRES_PASSWORD',
    'AWS_SECRET_ACCESS_KEY',
    'SENTRY_DSN',
    'RESEND_API_KEY',
    'RAILWAY_TOKEN',
    'UNKNOWN_FLAG',
  ])('rejects every unowned or noncanonical %s', (name) => {
    expect(() => assertAiAdmissionEnvironmentIsIsolated({ [name]: '' })).toThrow(name)
  })

  it('rejects case-insensitive duplicate aliases', () => {
    expect(() =>
      assertAiAdmissionEnvironmentIsIsolated({
        AI_CONTROL_DATABASE_URL: 'one',
        ai_control_database_url: 'two',
      }),
    ).toThrow('ai_control_database_url')
  })

  it('requires exact release, deployment, and runtime catalogue evidence', () => {
    const environment = admissionEnvironment()
    expect(() => assertAiAdmissionRequiredEnvironment(environment)).not.toThrow()
    for (const [name, message] of [
      [
        'AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION',
        'AI admission deployment profile version is invalid',
      ],
      [
        'AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST',
        'AI admission deployment profile digest is invalid',
      ],
      [
        'AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST',
        'AI admission runtime capability catalogue digest is invalid',
      ],
      ['AI_REQUEST_BINDING_KEYRING_GENERATION', 'AI admission key inventory is invalid'],
      ['AI_ADMISSION_KEYRING_GENERATION', 'AI admission key inventory is invalid'],
      ['AI_ADMISSION_ED25519_KID', 'AI admission key inventory is invalid'],
      ['RELEASE_SHA', 'AI admission release SHA is invalid'],
    ] as const) {
      expect(() =>
        assertAiAdmissionRequiredEnvironment({
          ...environment,
          [name]: '0',
        }),
      ).toThrow(message)
    }
  })
  it('defaults missing admission host, port, and profile metadata', () => {
    const environment = admissionEnvironment()
    delete environment.HOST
    delete environment.PORT
    delete environment.AI_KEY_INVENTORY_PROFILE
    expect(() => assertAiAdmissionRequiredEnvironment(environment)).not.toThrow()
  })
  it.each([
    ['HOST', '0.0.0.0'],
    ['HOST', '::1'],
    ['PORT', '8444'],
    ['PORT', '443'],
  ])('rejects mutated private bind %s=%s', (name, value) => {
    expect(() =>
      assertAiAdmissionRequiredEnvironment({ ...admissionEnvironment(), [name]: value }),
    ).toThrow('AI admission bind address is invalid')
  })

  it('accepts documented Node/Railway deployment metadata and rejects one extra secret', () => {
    const environment = {
      ...admissionEnvironment(),
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
      RAILWAY_ENVIRONMENT_NAME: 'google-closed-beta',
      RAILWAY_GIT_AUTHOR: 'owner',
      RAILWAY_GIT_BRANCH: 'main',
      RAILWAY_GIT_COMMIT_MESSAGE: 'release',
      RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40),
      RAILWAY_GIT_REPO_NAME: 'rep-key',
      RAILWAY_GIT_REPO_OWNER: 'owner',
      RAILWAY_PRIVATE_DOMAIN: 'ai-execution-admission.railway.internal',
      RAILWAY_PROJECT_ID: 'project',
      RAILWAY_PROJECT_NAME: 'reputation-key',
      RAILWAY_REPLICA_ID: 'replica',
      RAILWAY_REPLICA_REGION: 'us-west2',
      RAILWAY_SERVICE_ID: 'service',
      RAILWAY_SERVICE_NAME: 'ai-execution-admission',
      RAILWAY_SNAPSHOT_ID: 'snapshot',
    }
    expect(() => assertAiAdmissionRequiredEnvironment(environment)).not.toThrow()
    expect(() =>
      assertAiAdmissionRequiredEnvironment({ ...environment, OPENAI_API_KEY: 'secret' }),
    ).toThrow('OPENAI_API_KEY')
  })

  it('keeps compose admission inventory equal to its owned required names', () => {
    expect(admissionComposeEnvironmentNames().sort()).toEqual(
      ['NODE_ENV', ...AI_ADMISSION_REQUIRED_ENVIRONMENT_NAMES].sort(),
    )
  })

  it('zeroes decoded private-key bytes after both success and import failure', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const encoded = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
    const observed: Buffer[] = []
    const successImporter: typeof createPrivateKey = vi.fn((input) => {
      if (
        !input ||
        typeof input !== 'object' ||
        !('key' in input) ||
        !Buffer.isBuffer(input.key)
      ) {
        throw new Error('expected buffered private key input')
      }
      observed.push(input.key)
      return privateKey
    })
    expect(loadEd25519PrivateKey(encoded, successImporter)).toBe(privateKey)
    expect(observed[0]?.every((byte) => byte === 0)).toBe(true)

    observed.length = 0
    const failedImporter: typeof createPrivateKey = vi.fn((input) => {
      if (
        !input ||
        typeof input !== 'object' ||
        !('key' in input) ||
        !Buffer.isBuffer(input.key)
      ) {
        throw new Error('expected buffered private key input')
      }
      observed.push(input.key)
      throw new Error('fault')
    })
    expect(() => loadEd25519PrivateKey(encoded, failedImporter)).toThrow(
      'AI admission signing key is invalid',
    )
    expect(observed[0]?.every((byte) => byte === 0)).toBe(true)
    const neverImporter: typeof createPrivateKey = vi.fn()
    expect(() => loadEd25519PrivateKey('A'.repeat(16_385), neverImporter)).toThrow(
      'AI admission signing key is invalid',
    )
    expect(neverImporter).not.toHaveBeenCalled()
  })
})
