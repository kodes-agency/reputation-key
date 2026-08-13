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

  it('assigns isolated loopback database and Redis ports to every mode', () => {
    const ports = (['e2e', 'perf', 'beta'] as const).map(localStackHostPorts)

    expect(new Set(ports.map(({ postgres }) => postgres))).toHaveLength(3)
    expect(new Set(ports.map(({ redis }) => redis))).toHaveLength(3)
    expect(ports).toEqual([
      { postgres: 55432, redis: 56379 },
      { postgres: 55433, redis: 56380 },
      { postgres: 55434, redis: 56381 },
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
      E2E_WEB_EXECUTION_IDENTITY: '',
      STACK_ARTIFACT_DIR: '/tmp/repkey-artifacts',
      STACK_E2E_DIR: '/tmp/repkey-e2e',
    })
    expect(env.POSTGRES_HOST_PORT).toBe('55434')
    expect(env.REDIS_HOST_PORT).toBe('56381')
    expect(env.BETTER_AUTH_SECRET).toHaveLength(64)
    expect(env.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(env.OAUTH_STATE_SECRET).toMatch(/^[a-f0-9]{64}$/)
    expect(env.POSTGRES_PASSWORD).not.toContain('password')
  })

  it('sets only account-bootstrap overrides on the permissive E2E web', () => {
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
