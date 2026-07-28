// Tests for the BQC-6.1 canonical test-environment builder.
// Pins: the deterministic floor (bare shell → complete, non-empty, schema-valid
// env), the explicit-override passthroughs, and the Storybook no-env boundary.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getEnv, resetEnv } from '#/shared/config/env'
import {
  testEnvironment,
  DEFAULT_TEST_DATABASE_URL,
  DEFAULT_TEST_REDIS_URL,
} from './test-environment'

describe('testEnvironment (BQC-6.1)', () => {
  it('produces a deterministic, fully non-empty env from an empty shell', () => {
    const a = testEnvironment({})
    const b = testEnvironment({})
    expect(a).toEqual(b)
    for (const [key, value] of Object.entries(a)) {
      expect(value.length, `${key} must be non-empty`).toBeGreaterThan(0)
    }
  })

  it('matches the CI placeholder literals where the workflow defines them', () => {
    const env = testEnvironment({})
    expect(env).toEqual({
      NODE_ENV: 'test',
      DATABASE_URL: DEFAULT_TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: 'test-test-test-test-test-test-test-test',
      BETTER_AUTH_URL: 'http://localhost:3000',
      RESEND_API_KEY: 're_test_key_for_testing_only',
      GOOGLE_CLIENT_ID: 'ci-placeholder-client-id',
      GOOGLE_CLIENT_SECRET: 'ci-placeholder-client-secret',
      ENCRYPTION_KEY: 'a'.repeat(64),
      OAUTH_STATE_SECRET: 'ab'.repeat(32),
      REDIS_URL: DEFAULT_TEST_REDIS_URL,
    })
  })

  it('satisfies the application env validation — no mid-run getEnv() failure', () => {
    const saved = { ...process.env }
    try {
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, testEnvironment({}))
      resetEnv()
      // The real validation path: a bare shell + the builder must parse clean.
      expect(() => getEnv()).not.toThrow()
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, saved)
      resetEnv()
    }
  })

  it('honors TEST_DATABASE_URL for the database (never plain DATABASE_URL)', () => {
    const custom = 'postgresql://test:test@localhost:5432/custom_scratch'
    const env = testEnvironment({ TEST_DATABASE_URL: custom })
    expect(env.DATABASE_URL).toBe(custom)
    // A shell DATABASE_URL alone must NOT redirect tests at a dev database.
    const fromShell = testEnvironment({
      DATABASE_URL: 'postgresql://dev:dev@localhost:5432/repkey_dev',
    })
    expect(fromShell.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL)
  })

  it('honors explicit REDIS_URL / Google / ENCRYPTION_KEY overrides', () => {
    const env = testEnvironment({
      REDIS_URL: 'redis://localhost:6380',
      GOOGLE_CLIENT_ID: 'real-dev-client-id',
      GOOGLE_CLIENT_SECRET: 'real-dev-client-secret',
      ENCRYPTION_KEY: 'b'.repeat(64),
    })
    expect(env.REDIS_URL).toBe('redis://localhost:6380')
    expect(env.GOOGLE_CLIENT_ID).toBe('real-dev-client-id')
    expect(env.GOOGLE_CLIENT_SECRET).toBe('real-dev-client-secret')
    expect(env.ENCRYPTION_KEY).toBe('b'.repeat(64))
  })
})

describe('storybook hermeticity (BQC-6.1)', () => {
  it('the storybook project needs NO env — .storybook/main.ts stub aliases stay the boundary', () => {
    const mainTs = readFileSync(
      fileURLToPath(new URL('../../../.storybook/main.ts', import.meta.url)),
      'utf8',
    )
    // The viteFinal stub aliases keep server-only modules (async_hooks,
    // TanStack server core via #/composition, pino) out of the browser
    // preview — that boundary, not env vars, is what makes stories hermetic.
    for (const stub of [
      'async-hooks',
      'review-reply-server',
      'observability-logger',
      'portal-links',
    ]) {
      expect(mainTs).toContain(`${stub}`)
    }
  })
})
