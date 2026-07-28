// Tests for the RedisTestLease guard (BQC-6.1).
// Verifies destructive queue operations cannot reach a shared/remote Redis,
// and that an unavailable LOCAL Redis skips cleanly (bounded probe, no hang).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { acquireRedisTestLease } from './redis-test-lease'
import { TestEnvironmentError } from './test-environment-lease'

// Save original env so we can restore after each test.
const originalEnv = { ...process.env }

describe('RedisTestLease (BQC-6.1)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
    delete process.env.ALLOW_REMOTE_TEST_DB
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  describe('environment checks', () => {
    it('rejects when NODE_ENV is not test', async () => {
      process.env.NODE_ENV = 'development'
      await expect(acquireRedisTestLease('redis://localhost:6379')).rejects.toMatchObject(
        {
          code: 'not_test_env',
        },
      )
    })

    it('rejects when ALLOW_DESTRUCTIVE_DB_TESTS is not "1"', async () => {
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS
      await expect(acquireRedisTestLease('redis://localhost:6379')).rejects.toMatchObject(
        {
          code: 'not_opted_in',
        },
      )
    })
  })

  describe('guard refusals (before any connection attempt)', () => {
    it('refuses a managed Redis host (upstash)', async () => {
      await expect(
        acquireRedisTestLease('rediss://default:secret@fancy-123.upstash.io:6379'),
      ).rejects.toMatchObject({ code: 'denylisted_host' })
    })

    it('refuses a non-local host and names it', async () => {
      let error: unknown
      try {
        await acquireRedisTestLease('redis://cache.internal.example.com:6379')
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(TestEnvironmentError)
      expect(error).toMatchObject({ code: 'remote_host_refused' })
      expect((error as Error).message).toContain('cache.internal.example.com')
    })

    it('still applies the denylist when ALLOW_REMOTE_TEST_DB=1', async () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      await expect(
        acquireRedisTestLease('rediss://default:secret@fancy-123.upstash.io:6379'),
      ).rejects.toMatchObject({ code: 'denylisted_host' })
    })

    it('rejects an invalid URL', async () => {
      await expect(acquireRedisTestLease('not-a-url')).rejects.toMatchObject({
        code: 'invalid_url',
      })
    })
  })

  describe('availability probe', () => {
    it('reports available=false against a dead local port (bounded — no hang)', async () => {
      const lease = await acquireRedisTestLease('redis://localhost:5999')
      expect(lease.available).toBe(false)
      expect(lease.redis).toBeUndefined()
      lease.release()
    }, 15_000)

    it('honors ALLOW_REMOTE_TEST_DB=1: a remote host is attempted, not refused', async () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      // Nothing listens there — the guard does not throw; the probe reports
      // unavailability instead (refuses REMOTE only without the opt-out).
      const lease = await acquireRedisTestLease('redis://cache.internal.example.com:6379')
      expect(lease.available).toBe(false)
      lease.release()
    }, 15_000)
  })
})
