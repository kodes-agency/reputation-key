import type {
  GoogleQuotaCoordinator,
  GoogleQuotaKey,
  GoogleQuotaResult,
} from './contracts'

const FINGERPRINT = /^[a-f0-9]{64}$/

function fullKeyBinding(key: GoogleQuotaKey): string | null {
  if (
    !FINGERPRINT.test(key.credentialFingerprint) ||
    !FINGERPRINT.test(key.projectFingerprint)
  )
    return null
  return JSON.stringify([
    key.credentialFingerprint,
    key.projectFingerprint,
    key.endpointClass,
    key.organizationId,
    key.initiatorUserId,
    key.connectionId,
    key.propertyId,
  ])
}

export function createInMemoryGoogleQuotaCoordinator(
  deps: Readonly<{
    nowMs: () => number
    capacity: number
    refillTokensPerSecond: number
  }>,
): GoogleQuotaCoordinator {
  if (
    !Number.isSafeInteger(deps.capacity) ||
    deps.capacity < 1 ||
    !Number.isFinite(deps.refillTokensPerSecond) ||
    deps.refillTokensPerSecond <= 0
  ) {
    throw new Error('Google quota configuration is invalid')
  }
  const buckets = new Map<string, { tokens: number; updatedAtMs: number }>()
  const refillPerMs = deps.refillTokensPerSecond / 1_000

  return Object.freeze({
    acquire: async (key, cost, deadlineMs): Promise<GoogleQuotaResult> => {
      const nowMs = deps.nowMs()
      const id = fullKeyBinding(key)
      if (
        !id ||
        !Number.isSafeInteger(cost) ||
        cost < 1 ||
        cost > deps.capacity ||
        !Number.isSafeInteger(deadlineMs)
      ) {
        return { ok: false, code: 'invalid_request', retryAfterMs: 0 }
      }
      if (deadlineMs <= nowMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      const current = buckets.get(id) ?? {
        tokens: deps.capacity,
        updatedAtMs: nowMs,
      }
      const elapsedMs = Math.max(0, nowMs - current.updatedAtMs)
      current.tokens = Math.min(deps.capacity, current.tokens + elapsedMs * refillPerMs)
      current.updatedAtMs = nowMs
      if (current.tokens >= cost) {
        current.tokens -= cost
        buckets.set(id, current)
        return { ok: true, remaining: Math.floor(current.tokens) }
      }
      buckets.set(id, current)
      const retryAfterMs = Math.ceil((cost - current.tokens) / refillPerMs)
      if (nowMs + retryAfterMs > deadlineMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs }
      }
      return { ok: false, code: 'quota_exhausted', retryAfterMs }
    },
  })
}
