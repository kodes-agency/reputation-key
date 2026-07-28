// Tests for TestEnvironmentLease guard (B0.3).
// Verifies that destructive tests cannot reach a non-disposable database.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  acquireTestLease,
  validateTestDatabaseUrl,
  validateTestDatabaseTarget,
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

    it('rejects railway hosts', () => {
      // railway.app matches the denylist directly.
      expect(() =>
        validateTestDatabaseUrl('postgresql://user:pass@db.up.railway.app:5432/railway'),
      ).toThrow(TestEnvironmentError)
      // monorail.proxy.rlwy.net doesn't match "railway.app" — BQC-6.1 refuses
      // it anyway via the localhost requirement (remote_host_refused).
      expect(() =>
        validateTestDatabaseUrl(
          'postgresql://user:pass@monorail.proxy.rlwy.net:6543/railway',
        ),
      ).toThrow(TestEnvironmentError)
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

  describe('localhost requirement (BQC-6.1)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
      delete process.env.ALLOW_REMOTE_TEST_DB
    })

    it('refuses a non-local host, names it, and codes the refusal', () => {
      let error: unknown
      try {
        validateTestDatabaseUrl('postgresql://user:pass@db.example.com:5432/test')
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(TestEnvironmentError)
      expect(error).toMatchObject({ code: 'remote_host_refused' })
      expect((error as Error).message).toContain('db.example.com')
    })

    it('accepts localhost, 127.0.0.1, ::1, and unix-socket targets', () => {
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@localhost:5432/test'),
      ).not.toThrow()
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@127.0.0.1:5432/test'),
      ).not.toThrow()
      expect(() =>
        validateTestDatabaseUrl('postgresql://test:test@[::1]:5432/test'),
      ).not.toThrow()
      expect(() => validateTestDatabaseUrl('postgresql:///test')).not.toThrow()
    })

    it('honors ALLOW_REMOTE_TEST_DB=1 for a non-denylisted remote host', () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      expect(() =>
        validateTestDatabaseUrl('postgresql://user:pass@db.example.com:5432/test'),
      ).not.toThrow()
    })

    it('still applies the denylist when ALLOW_REMOTE_TEST_DB=1', () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      expect(() =>
        validateTestDatabaseUrl(
          'postgresql://user:pass@ep-cool.us-east-2.aws.neon.tech/dbname',
        ),
      ).toThrow(TestEnvironmentError)
    })

    it('validateTestDatabaseTarget guards host/name without the destructive-test env flags', () => {
      delete process.env.NODE_ENV
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS
      expect(() =>
        validateTestDatabaseTarget('postgresql://test:test@localhost:5432/test'),
      ).not.toThrow()
      expect(() =>
        validateTestDatabaseTarget('postgresql://user:pass@db.example.com:5432/test'),
      ).toThrow(TestEnvironmentError)
      expect(() =>
        validateTestDatabaseTarget('postgresql://test:test@localhost:5432/prod'),
      ).toThrow(TestEnvironmentError)
    })
  })
})
