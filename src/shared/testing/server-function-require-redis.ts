import type { Redis } from 'ioredis'

/**
 * The harness's test Redis for a test whose subject is a rate limit. A test that
 * asserts a refusal fails when there is no Redis, rather than passing with
 * nothing asserted.
 */
export function requireHarnessRedis(
  harness: Readonly<{ redis: () => Redis | undefined }>,
): Redis {
  const redis = harness.redis()
  if (!redis)
    throw new Error(
      'This test counts rate limits and needs the local test Redis (see redis-test-lease.ts)',
    )
  return redis
}
