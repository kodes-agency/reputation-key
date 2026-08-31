import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { getJobRedisUrl } from './redis-topology'

const JOB_REDIS_MINIMUM_VERSION = '6.2.0' as const
const JOB_REDIS_INSPECTION_TIMEOUT_MS = 5_000
const JOB_REDIS_HEALTH_TIMEOUT_MS = 1_500

export type JobRedisReadinessCode =
  | 'inspection_unavailable'
  | 'version_unsupported'
  | 'getdel_unavailable'
  | 'maxmemory_policy_invalid'

export type JobRedisReadiness =
  | Readonly<{
      ok: true
      redisVersion: string
      maxmemoryPolicy: 'noeviction'
      getdelAvailable: true
    }>
  | Readonly<{ ok: false; code: JobRedisReadinessCode }>

function infoValue(raw: string, key: string): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim()
  }
  return undefined
}

function isSupportedVersion(version: string | undefined): version is string {
  if (!version) return false
  const components = version.split('.')
  if (components.length < 2) return false
  const major = Number(components[0])
  const minor = Number(components[1])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return false
  const [minimumMajor, minimumMinor] = JOB_REDIS_MINIMUM_VERSION.split('.').map(Number)
  return major > minimumMajor! || (major === minimumMajor && minor >= minimumMinor!)
}

function configValue(raw: unknown, key: string): string | undefined {
  if (!Array.isArray(raw)) return undefined
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === key) return String(raw[index + 1])
  }
  return undefined
}

function commandIsAvailable(raw: unknown): boolean {
  return (
    Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0]) && raw[0].length > 0
  )
}

/**
 * Inspect the Redis instance that owns BullMQ state. Ambiguous or denied
 * inspection fails closed because eviction or an incomplete command surface
 * can silently corrupt queue behavior.
 */
export async function verifyJobRedisRuntime(redis: Redis): Promise<JobRedisReadiness> {
  try {
    const rawInfo = await redis.info('server')
    const redisVersion = infoValue(rawInfo, 'redis_version')
    if (!isSupportedVersion(redisVersion)) {
      return { ok: false, code: 'version_unsupported' }
    }

    const commandInfo = await redis.call('COMMAND', 'INFO', 'GETDEL')
    if (!commandIsAvailable(commandInfo)) {
      return { ok: false, code: 'getdel_unavailable' }
    }

    const policy = configValue(
      await redis.config('GET', 'maxmemory-policy'),
      'maxmemory-policy',
    )
    if (policy !== 'noeviction') {
      return { ok: false, code: 'maxmemory_policy_invalid' }
    }

    return {
      ok: true,
      redisVersion,
      maxmemoryPolicy: policy,
      getdelAvailable: true,
    }
  } catch {
    return { ok: false, code: 'inspection_unavailable' }
  }
}

export async function assertJobRedisRuntime(
  redis: Redis,
): Promise<Extract<JobRedisReadiness, { ok: true }>> {
  const readiness = await verifyJobRedisRuntime(redis)
  if (!readiness.ok) {
    throw new Error(`[CONFIG] BullMQ Redis runtime is incompatible: ${readiness.code}`)
  }
  return readiness
}

/**
 * Open one bounded, fail-fast inspection connection before BullMQ constructs
 * any long-lived producer or consumer connection. Errors are deliberately
 * reduced to readiness codes so credentials/hosts cannot leak through boot
 * logs. The inspection client never owns runtime work and is disconnected
 * immediately after the check.
 */
export async function assertConfiguredJobRedisRuntime(
  redisUrl: string,
): Promise<Extract<JobRedisReadiness, { ok: true }>> {
  const redis = new Redis(redisUrl, {
    commandTimeout: JOB_REDIS_INSPECTION_TIMEOUT_MS,
    connectTimeout: JOB_REDIS_INSPECTION_TIMEOUT_MS,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  // ioredis emits `error` even when connect()/commands reject. Without a
  // listener EventEmitter would turn a configuration diagnosis into an
  // unhandled process error. The sanitized assertion below is authoritative.
  redis.on('error', () => undefined)
  try {
    try {
      await redis.connect()
    } catch {
      throw new Error(
        '[CONFIG] BullMQ Redis runtime is incompatible: inspection_unavailable',
      )
    }
    return await assertJobRedisRuntime(redis)
  } finally {
    redis.disconnect()
  }
}

/** Bounded health probe for the dedicated queue endpoint after boot. */
export async function isJobRedisHealthy(): Promise<boolean> {
  const redisUrl = getJobRedisUrl(getEnv())
  if (!redisUrl) return false
  const redis = new Redis(redisUrl, {
    commandTimeout: JOB_REDIS_HEALTH_TIMEOUT_MS,
    connectTimeout: JOB_REDIS_HEALTH_TIMEOUT_MS,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  redis.on('error', () => undefined)
  try {
    await redis.connect()
    return (await redis.ping()) === 'PONG'
  } catch {
    return false
  } finally {
    redis.disconnect()
  }
}
