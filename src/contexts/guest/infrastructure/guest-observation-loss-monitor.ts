import type {
  GuestObservationLossMonitor,
  GuestObservationLossSnapshot,
} from '../application/ports/guest-observation-loss-monitor.port'

/** Five-minute buckets match the health-check cadence. */
export const GUEST_OBSERVATION_LOSS_BUCKET_MS = 5 * 60 * 1000
/** A bounded trailing window; no event-level or tenant-scoped record is retained. */
export const GUEST_OBSERVATION_LOSS_RETENTION_MS = 24 * 60 * 60 * 1000

const DEFAULT_PREFIX = 'ops:guest-observation-loss:v1'
const KINDS = ['scan', 'review_link'] as const
const AGGREGATE_SUFFIX = 'aggregate'
const AGGREGATE_TTL_MS =
  GUEST_OBSERVATION_LOSS_RETENTION_MS + GUEST_OBSERVATION_LOSS_BUCKET_MS

export type GuestObservationLossRedisPort = Readonly<{
  eval(
    script: string,
    numberOfKeys: number,
    ...args: ReadonlyArray<string | number>
  ): Promise<unknown>
}>

const PRUNE_FIELDS = `
local fields = redis.call('HKEYS', KEYS[1])
for _, field in ipairs(fields) do
  if field ~= 'continuity' then
    local kind, start = string.match(field, '^([%a_]+):(%d+)$')
    if start and tonumber(start) < tonumber(ARGV[4]) then
      redis.call('HDEL', KEYS[1], field)
    end
  end
end
`

const INCREMENT_AGGREGATE = `
${PRUNE_FIELDS}
local continuityStart = redis.call('HGET', KEYS[1], 'continuity')
if not continuityStart then
  redis.call('HSET', KEYS[1], 'continuity', ARGV[2])
end
local count = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return count
`

const READ_AGGREGATE = `
${PRUNE_FIELDS}
local continuityStart = redis.call('HGET', KEYS[1], 'continuity')
if not continuityStart then
  redis.call('HSET', KEYS[1], 'continuity', ARGV[2])
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return redis.call('HGETALL', KEYS[1])
`

function bucketStart(time: Date): number {
  return (
    Math.floor(time.getTime() / GUEST_OBSERVATION_LOSS_BUCKET_MS) *
    GUEST_OBSERVATION_LOSS_BUCKET_MS
  )
}

function unavailableSnapshot(): GuestObservationLossSnapshot {
  return {
    monitorAvailable: false,
    windowMs: GUEST_OBSERVATION_LOSS_RETENTION_MS,
    precisionMs: GUEST_OBSERVATION_LOSS_BUCKET_MS,
    scanLossCount: 0,
    reviewLinkLossCount: 0,
    ratingLossCount: 0,
    totalLossCount: 0,
    ratingDisposition: 'not_applicable_durable',
  }
}

function parseCount(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('guest_observation_loss_monitor_invalid_count')
  }
  return value
}

function parseEpoch(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('guest_observation_loss_monitor_invalid_continuity')
  }
  return value
}

function parseAggregate(
  raw: unknown,
  first: number,
  last: number,
): Readonly<{
  continuityStart: number
  scanLossCount: number
  reviewLinkLossCount: number
}> {
  if (!Array.isArray(raw) || raw.length % 2 !== 0) {
    throw new Error('guest_observation_loss_monitor_invalid_aggregate')
  }
  let continuityStart: number | null = null
  let scanLossCount = 0
  let reviewLinkLossCount = 0
  for (let index = 0; index < raw.length; index += 2) {
    const field = String(raw[index])
    const value = raw[index + 1]
    if (field === 'continuity') {
      if (continuityStart !== null) {
        throw new Error('guest_observation_loss_monitor_duplicate_continuity')
      }
      continuityStart = parseEpoch(value)
      continue
    }
    const match = /^(scan|review_link):(\d+)$/u.exec(field)
    if (!match) throw new Error('guest_observation_loss_monitor_invalid_field')
    const start = parseEpoch(match[2])
    if (start < first || start > last) {
      throw new Error('guest_observation_loss_monitor_invalid_bucket')
    }
    const count = parseCount(value)
    if (match[1] === 'scan') scanLossCount += count
    else reviewLinkLossCount += count
    if (
      !Number.isSafeInteger(scanLossCount) ||
      !Number.isSafeInteger(reviewLinkLossCount)
    ) {
      throw new Error('guest_observation_loss_monitor_count_overflow')
    }
  }
  if (continuityStart === null) {
    throw new Error('guest_observation_loss_monitor_missing_continuity')
  }
  return { continuityStart, scanLossCount, reviewLinkLossCount }
}

/**
 * Redis is the cross-replica/process-restart authority. One hash key contains
 * only a continuity epoch and coarse bucket/class counters. Keeping coverage
 * and counters in the same evictable unit prevents selective key eviction from
 * masquerading as zero. Every access prunes expired fields and applies a
 * bounded TTL; a reset/eviction therefore warms visibly for one full window.
 */
export const createGuestObservationLossMonitor = (
  redis: GuestObservationLossRedisPort | null | undefined,
  /** Test isolation only; production composition never supplies this option. */
  options?: Readonly<{ testKeyPrefix?: string }>,
): GuestObservationLossMonitor => {
  if (
    options?.testKeyPrefix &&
    !/^test:guest-observation-loss:[A-Za-z0-9-]{1,64}$/u.test(options.testKeyPrefix)
  ) {
    throw new Error('guest_observation_loss_test_prefix_invalid')
  }
  const prefix = options?.testKeyPrefix ?? DEFAULT_PREFIX
  return {
    async record(input) {
      if (!(KINDS as readonly string[]).includes(input.kind)) {
        throw new Error('guest_observation_loss_kind_not_supported')
      }
      if (!redis) throw new Error('guest_observation_loss_monitor_unavailable')
      const start = bucketStart(input.occurredAt)
      if (!Number.isSafeInteger(start)) {
        throw new Error('guest_observation_loss_occurred_at_invalid')
      }
      const cutoff = bucketStart(
        new Date(input.occurredAt.getTime() - GUEST_OBSERVATION_LOSS_RETENTION_MS),
      )
      await redis.eval(
        INCREMENT_AGGREGATE,
        1,
        `${prefix}:${AGGREGATE_SUFFIX}`,
        `${input.kind}:${start}`,
        input.occurredAt.getTime(),
        AGGREGATE_TTL_MS,
        cutoff,
      )
    },

    async read(asOf) {
      if (!redis) return unavailableSnapshot()
      try {
        const asOfMs = asOf.getTime()
        if (!Number.isSafeInteger(asOfMs) || asOfMs < 0) return unavailableSnapshot()
        const last = bucketStart(asOf)
        const first = bucketStart(new Date(asOfMs - GUEST_OBSERVATION_LOSS_RETENTION_MS))
        const aggregate = parseAggregate(
          await redis.eval(
            READ_AGGREGATE,
            1,
            `${prefix}:${AGGREGATE_SUFFIX}`,
            'unused',
            asOfMs,
            AGGREGATE_TTL_MS,
            first,
          ),
          first,
          last,
        )
        const continuityStart = aggregate.continuityStart
        const observedWindowMs = asOfMs - continuityStart
        if (
          observedWindowMs < GUEST_OBSERVATION_LOSS_RETENTION_MS ||
          observedWindowMs < 0
        ) {
          return unavailableSnapshot()
        }

        const { scanLossCount, reviewLinkLossCount } = aggregate
        return {
          monitorAvailable: true,
          windowMs: GUEST_OBSERVATION_LOSS_RETENTION_MS,
          precisionMs: GUEST_OBSERVATION_LOSS_BUCKET_MS,
          scanLossCount,
          reviewLinkLossCount,
          ratingLossCount: 0,
          totalLossCount: scanLossCount + reviewLinkLossCount,
          ratingDisposition: 'not_applicable_durable',
        }
      } catch {
        return unavailableSnapshot()
      }
    },
  }
}
