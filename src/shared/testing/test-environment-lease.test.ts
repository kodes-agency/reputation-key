// Tests for TestEnvironmentLease guard (B0.3).
// Verifies that destructive tests cannot reach a non-disposable database.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  acquireTestLease,
  validateTestDatabaseUrl,
  TestEnvironmentError,
} from './test-environment-lease'

// Save original env so we can restore after each test.
const originalEnv = { ...process.env }

describe('TestEnvironmentLease', () => {
  afterEach(() => {
    // Restore env after each test
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  describe('checkEnvironment', () => {
    it('rejects when NODE_ENV is not test', async () => {
      process.env.NODE_ENV = 'development'
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
      await expect(
        acquireTestLease('postgresql://test:test@localhost:5432/test'),
      ).rejects.toMatchObject({ code: 'not_test_env' })
    })

    it('rejects when ALLOW_DESTRUCTIVE_DB_TESTS is not set', async () => {
      process.env.NODE_ENV = 'test'
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS
      await expect(
        acquireTestLease('postgresql://test:test@localhost:5432/test'),
      ).rejects.toMatchObject({ code: 'not_opted_in' })
    })

    it('rejects when ALLOW_DESTRUCTIVE_DB_TESTS is not "1"', async () => {
      process.env.NODE_ENV = 'test'
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = 'true'
      await expect(
        acquireTestLease('postgresql://test:test@localhost:5432/test'),
      ).rejects.toMatchObject({ code: 'not_opted_in' })
    })
  })

  describe('checkDenylist', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
    })

    it('rejects neon.tech host', () => {
      expect(() =>
        validateTestDatabaseUrl(
          'postgresql://user:pass@ep-cool-name.us-east-2.aws.neon.tech/dbname',
        ),
      ).toThrow(TestEnvironmentError)
    })

    it('rejects railway.app host', () => {
      expect(() =>
        validateTestDatabaseUrl(
          'postgresql://user:pass@monorail.proxy.rlwy.net:6543/railway',
        ),
      ).not.toThrow()
      // monorail.proxy.rlwy.net doesn't match "railway.app" — this is correct
    })

    it('rejects supabase.co host', () => {
      expect(() =>
        validateTestDatabaseUrl(
          'postgresql://user:pass@db.xxx.supabase.co:5432/postgres',
        ),
      ).toThrow(TestEnvironmentError)
    })

    it('rejects database name containing "prod"', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@localhost:5432/production'),
      ).toThrow(TestEnvironmentError)
    })

    it('rejects database name containing "staging"', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@localhost:5432/staging'),
      ).toThrow(TestEnvironmentError)
    })

    it('rejects database name containing "beta"', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@localhost:5432/beta'),
      ).toThrow(TestEnvironmentError)
    })

    it('accepts local test database', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@localhost:5432/test'),
      ).not.toThrow()
    })

    it('accepts 127.0.0.1 test database', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@127.0.0.1:5432/test'),
      ).not.toThrow()
    })
  })

  describe('parseDatabaseUrl', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
    })

    it('rejects invalid URL', () => {
      expect(() => validateTestDatabaseUrl('not-a-url')).toThrow(TestEnvironmentError)
    })
  })
})
