import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLocalStackEnv,
  createMigrationHeadProof,
  deterministicFixtureHash,
  expectedMigrationHead,
  localStackHostPorts,
  localStackProject,
  parseLocalStackMode,
  sha256,
} from './local-stack-controller'
import { LOCAL_E2E_BOOTSTRAP_CAPABILITIES } from '#/shared/config/local-stack-contract'

describe('local stack controller', () => {
  it.each([
    ['e2e', 'repkey-e2e'],
    ['perf', 'repkey-perf'],
    ['beta', 'repkey-beta'],
  ] as const)('isolates %s resources under %s', (mode, project) => {
    expect(localStackProject(mode)).toBe(project)
    expect(parseLocalStackMode(mode)).toBe(mode)
  })

  it('assigns isolated loopback service ports to every mode', () => {
    const ports = (['e2e', 'perf', 'beta'] as const).map(localStackHostPorts)

    expect(new Set(ports.map(({ postgres }) => postgres))).toHaveLength(3)
    expect(new Set(ports.map(({ redis }) => redis))).toHaveLength(3)
    expect(new Set(ports.map(({ googleGateway }) => googleGateway))).toHaveLength(3)
    expect(ports).toEqual([
      { postgres: 55432, redis: 56379, googleGateway: 58443 },
      { postgres: 55433, redis: 56380, googleGateway: 58444 },
      { postgres: 55434, redis: 56381, googleGateway: 58445 },
    ])
  })

  it('rejects unknown modes', () => {
    expect(() => parseLocalStackMode('production')).toThrow(/mode/i)
  })

  it('generates revision-bound production configuration without developer env input', () => {
    const env = buildLocalStackEnv({
      mode: 'beta',
      revision: 'a'.repeat(40),
      artifactDir: '/tmp/repkey-artifacts',
      e2eDir: '/tmp/repkey-e2e',
    })

    expect(env).toMatchObject({
      COMPOSE_PROJECT_NAME: 'repkey-beta',
      SOURCE_REVISION: 'a'.repeat(40),
      E2E_WEB_CAPABILITY_OVERRIDE: '',
      E2E_WEB_EXECUTION_IDENTITY: 'local-playwright-beta',
      STACK_ARTIFACT_DIR: '/tmp/repkey-artifacts',
      STACK_E2E_DIR: '/tmp/repkey-e2e',
    })
    expect(env.POSTGRES_HOST_PORT).toBe('55434')
    expect(env.REDIS_HOST_PORT).toBe('56381')
    expect(env.GOOGLE_EGRESS_GATEWAY_HOST_PORT).toBe('58445')
    expect(env.BETTER_AUTH_SECRET).toHaveLength(64)
    expect(env.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(env.OAUTH_STATE_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(env.PROVIDER_EPHEMERAL_REDIS_PASSWORD).toMatch(/^[a-f0-9]{64}$/)
    expect(env.GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GOOGLE_REPLAY_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GOOGLE_SESSION_BINDING_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GOOGLE_ADMISSION_GRANT_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GOOGLE_ADMISSION_DATABASE_PASSWORD).toMatch(/^[a-f0-9]{64}$/)
    expect(env.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.AI_CONTROL_DATABASE_PASSWORD).toMatch(/^[a-f0-9]{64}$/)
    expect(env.AI_SUBJECT_HMAC_KEYS).toMatch(/^subject-v1:[a-f0-9]{64}$/)
    expect(env.AI_REQUEST_BINDING_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.AI_ADMISSION_ED25519_KID).toBe('admission-v1')
    expect(env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS).toMatch(/^local:[a-f0-9]{64}$/)
    expect(env.GUEST_SESSION_SALT).toMatch(/^[a-f0-9]{64}$/)
    expect(env.GUEST_CONTACT_ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(env.GUEST_ABUSE_HASH_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(env.PORTAL_TOKEN_HASH_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(env.OPS_METRICS_TOKEN).toMatch(/^[a-f0-9]{64}$/)
    expect(env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS).toBe(
      env.REVIEW_PROVIDER_SUBJECT_HMAC_KEYS,
    )
    expect(env.POSTGRES_PASSWORD).not.toContain('password')
  })

  it('sets no product capability overrides on the E2E web', () => {
    const env = buildLocalStackEnv({
      mode: 'e2e',
      revision: 'b'.repeat(40),
      artifactDir: '/tmp/repkey-artifacts',
      e2eDir: '/tmp/repkey-e2e',
    })
    expect(env.E2E_WEB_CAPABILITY_OVERRIDE).toBe(
      LOCAL_E2E_BOOTSTRAP_CAPABILITIES.join(','),
    )
    expect(env.E2E_WEB_EXECUTION_IDENTITY).toBe('local-playwright-e2e')
  })

  it('binds clean and upgrade proofs to the exact journal SQL head', () => {
    const root = mkdtempSync(join(tmpdir(), 'repkey-stack-head-'))
    const migrations = join(root, 'drizzle')
    mkdirSync(migrations)
    writeFileSync(
      join(migrations, 'meta.json'),
      JSON.stringify({ entries: [{ tag: '0001_head', when: 1234 }] }),
    )
    writeFileSync(join(migrations, '0001_head.sql'), 'SELECT 1;\n')

    const expected = expectedMigrationHead(join(migrations, 'meta.json'), migrations)
    const proof = createMigrationHeadProof({
      runKind: 'upgrade',
      expected,
      appliedCount: 1,
      appliedHash: sha256('SELECT 1;\n'),
      appliedWhen: 1234,
    })

    expect(proof).toMatchObject({
      runKind: 'upgrade',
      expectedTag: '0001_head',
      appliedCount: 1,
      matched: true,
    })
    expect(
      createMigrationHeadProof({ ...proof, expected, appliedHash: 'wrong' }).matched,
    ).toBe(false)
  })

  it('hashes the mixed P1/P2 fleet contract independently of capability order', () => {
    const a = deterministicFixtureHash({
      seed: 'fleet',
      properties: 5_000,
      p1Properties: 2_500,
      capabilities: ['goal.use', 'portal.read'],
    })
    const b = deterministicFixtureHash({
      seed: 'fleet',
      properties: 5_000,
      p1Properties: 2_500,
      capabilities: ['portal.read', 'goal.use'],
    })

    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
