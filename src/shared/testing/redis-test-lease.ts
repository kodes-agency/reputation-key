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
// skip-cleanly-on-unavailable behavior. That is for a developer machine.
//
// Where Redis MUST exist, set REQUIRE_TEST_REDIS=1 and ABSENT is refused too:
// a probe that fails or times out throws, so the suite fails in beforeAll
// instead of returning before its first assertion and reporting green. CI's
// test-integration job sets it beside its Redis service
// (.github/workflows/ci.yml); redis-test-lease.test.ts pins that wiring. Run
// `REQUIRE_TEST_REDIS=1 pnpm test:integration` locally to prove the
// Redis-backed suites really ran.
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
  /**
   * True when the ping succeeded; suites skip their Redis-dependent tests when
   * false. Never false under REQUIRE_TEST_REDIS=1 — acquiring throws instead.
   */
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

type RedisEndpoint = Readonly<{ host: string; port: string }>

function parseRedisEndpoint(url: string): RedisEndpoint {
  try {
    const parsed = new URL(url)
    return { host: parsed.hostname, port: parsed.port }
  } catch {
    throw new TestEnvironmentError(
      'invalid_url',
      `REDIS_URL is not a valid URL: ${url.replace(/:[^:@]+@/, ':***@')}`,
    )
  }
}

/**
 * Bound on the availability probe — unreachable local Redis must skip fast, not
 * hang. A local Redis answers the whole connect + ping in a few milliseconds,
 * so the same bound holds where Redis is required.
 */
const PROBE_TIMEOUT_MS = 2500

/**
 * Reads REQUIRE_TEST_REDIS. Only "1" requires Redis; unset or empty keeps the
 * skip. Any other value is refused: a mistyped switch (`true`, `yes`) would
 * leave the suites skipping while the job believes Redis is required.
 */
function isRedisRequired(): boolean {
  const value = process.env.REQUIRE_TEST_REDIS
  if (value === undefined || value === '') return false
  if (value === '1') return true
  throw new TestEnvironmentError(
    'invalid_redis_requirement',
    `REQUIRE_TEST_REDIS is "${value}", expected "1" or unset. ` +
      'Set REQUIRE_TEST_REDIS=1 to fail, not skip, when the test Redis is unreachable.',
  )
}

function describeProbeFailure(probeError: unknown, connectionError?: Error): string {
  const failure = probeError instanceof Error ? probeError.message : String(probeError)
  return connectionError
    ? `${failure}; last connection error: ${connectionError.message}`
    : failure
}

/**
 * The refusal for a required Redis that did not answer. It names host and port
 * only — the URL may carry a password.
 */
function requiredRedisUnreachable(
  endpoint: RedisEndpoint,
  failure: string,
): TestEnvironmentError {
  const address =
    endpoint.port === '' ? endpoint.host : `${endpoint.host}:${endpoint.port}`
  return new TestEnvironmentError(
    'redis_required_unreachable',
    `Redis at "${address}" did not answer the test probe (${failure}) and REQUIRE_TEST_REDIS=1 requires it. ` +
      'The Redis-backed tests would have returned before their first assertion. ' +
      'Start that Redis, or unset REQUIRE_TEST_REDIS on a machine without one.',
  )
}

/**
 * Acquire a Redis test lease. Validates the environment and refuses remote /
 * managed hosts, then pings with a bounded probe. An unreachable LOCAL Redis
 * is not an error unless REQUIRE_TEST_REDIS=1 — the lease reports
 * available=false so the suite skips.
 *
 * The probe is raced against PROBE_TIMEOUT_MS because the BullMQ-required
 * maxRetriesPerRequest:null option makes a plain ping() wait forever on a
 * dead connection (the client reconnects indefinitely).
 *
 * @param redisUrl - defaults to REDIS_URL, then the canonical local default.
 * @throws {TestEnvironmentError} on guard refusal, and on unavailability when
 *   REQUIRE_TEST_REDIS=1 (code `redis_required_unreachable`).
 */
export async function acquireRedisTestLease(redisUrl?: string): Promise<RedisTestLease> {
  checkEnvironment()
  const url = redisUrl ?? process.env.REDIS_URL ?? DEFAULT_TEST_REDIS_URL
  const endpoint = parseRedisEndpoint(url)
  checkRedisDenylist(endpoint.host)
  checkLocalTestHost(endpoint.host)
  const isRequired = isRedisRequired()

  const redis = new Redis(url, { maxRetriesPerRequest: null, connectTimeout: 2000 })
  // Connection errors never reject the ping (the client retries); the last one
  // is kept only to say why a required Redis did not answer.
  let connectionError: Error | undefined
  redis.on('error', (error) => {
    connectionError = error
  })
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`redis probe timeout after ${PROBE_TIMEOUT_MS} ms`)),
          PROBE_TIMEOUT_MS,
        )
      }),
    ])
    return { redis, available: true, release: () => redis.disconnect() }
  } catch (probeError) {
    redis.disconnect()
    if (!isRequired) return { redis: undefined, available: false, release: () => {} }
    throw requiredRedisUnreachable(
      endpoint,
      describeProbeFailure(probeError, connectionError),
    )
  } finally {
    clearTimeout(timer)
  }
}
