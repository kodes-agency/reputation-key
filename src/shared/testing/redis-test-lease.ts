// RedisTestLease — the Redis counterpart of TestEnvironmentLease (BQC-6.1).
//
// Integration suites that obliterate/flush BullMQ queues against a real Redis
// MUST acquire through this lease. The guard posture matches the DB lease:
//   1. NODE_ENV === 'test' and ALLOW_DESTRUCTIVE_DB_TESTS === '1'
//   2. The host does not match a denylist of managed/remote Redis providers
//      (upstash, redis-cloud, ...) or the shared managed-host denylist
//   3. The host is localhost / 127.0.0.1 / ::1 / a unix socket — destructive
//      queue operations against shared/remote Redis are refused BY NAME
//      (opt out ONLY via ALLOW_REMOTE_TEST_DB=1; the denylist still applies)
//
// The guard refuses REMOTE, not ABSENT: when the (local) Redis is simply not
// running, the lease returns available=false so suites keep their
// skip-cleanly-on-unavailable behavior.
//
// CONTRACT — destructive operations (obliterate, flush) may ONLY target
// suite-unique queue names. The shared local Redis hosts other suites' queues;
// BullMQ cross-talk is ruled out by name, never by wiping shared state.

import { Redis } from 'ioredis'
import {
  checkEnvironment,
  checkLocalTestHost,
  DENYLIST_HOST_PATTERNS,
  TestEnvironmentError,
} from './test-environment-lease'
import { DEFAULT_TEST_REDIS_URL } from './test-environment'

/** Managed/remote Redis providers — never safe for destructive queue operations. */
const REDIS_DENYLIST_HOST_PATTERNS = [
  ...DENYLIST_HOST_PATTERNS,
  'upstash.io',
  'redis-cloud.com',
  'redns.app',
]

export type RedisTestLease = Readonly<{
  /** The connected client — undefined when Redis is unavailable (skip cleanly). */
  redis: Redis | undefined
  /** True when the ping succeeded; suites skip their Redis-dependent tests when false. */
  available: boolean
  /** Release the lease (disconnects the client when connected). */
  release: () => void
}>

function checkRedisDenylist(host: string): void {
  const hostLower = host.toLowerCase()
  for (const pattern of REDIS_DENYLIST_HOST_PATTERNS) {
    if (hostLower.includes(pattern)) {
      throw new TestEnvironmentError(
        'denylisted_host',
        `Redis host "${host}" matches denylisted pattern "${pattern}". ` +
          'Destructive tests require a local or disposable Redis.',
      )
    }
  }
}

function parseRedisHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    throw new TestEnvironmentError(
      'invalid_url',
      `REDIS_URL is not a valid URL: ${url.replace(/:[^:@]+@/, ':***@')}`,
    )
  }
}

/** Bound on the availability probe — unreachable local Redis must skip fast, not hang. */
const PROBE_TIMEOUT_MS = 2500

/**
 * Acquire a Redis test lease. Validates the environment and refuses remote /
 * managed hosts, then pings with a bounded probe. An unreachable LOCAL Redis
 * is not an error — the lease reports available=false so the suite skips.
 *
 * The probe is raced against PROBE_TIMEOUT_MS because the BullMQ-required
 * maxRetriesPerRequest:null option makes a plain ping() wait forever on a
 * dead connection (the client reconnects indefinitely).
 *
 * @param redisUrl - defaults to REDIS_URL, then the canonical local default.
 * @throws {TestEnvironmentError} on guard refusal (never on unavailability).
 */
export async function acquireRedisTestLease(redisUrl?: string): Promise<RedisTestLease> {
  checkEnvironment()
  const url = redisUrl ?? process.env.REDIS_URL ?? DEFAULT_TEST_REDIS_URL
  const host = parseRedisHost(url)
  checkRedisDenylist(host)
  checkLocalTestHost(host)

  const redis = new Redis(url, { maxRetriesPerRequest: null, connectTimeout: 2000 })
  redis.on('error', () => {}) // probe failures are reported via available=false
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('redis probe timeout')),
          PROBE_TIMEOUT_MS,
        )
      }),
    ])
    return { redis, available: true, release: () => redis.disconnect() }
  } catch {
    redis.disconnect()
    return { redis: undefined, available: false, release: () => {} }
  } finally {
    clearTimeout(timer)
  }
}
