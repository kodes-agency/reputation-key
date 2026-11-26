import {
  GOOGLE_RETRY_MAX_MS,
  GOOGLE_RETRY_MIN_MS,
  googleRetryFloorMs,
} from './retry-floor'

export function parseGoogleRetryAfterMs(
  value: string | null,
  nowMs: number,
): number | null {
  if (value === null || !Number.isSafeInteger(nowMs)) return null
  const trimmed = value.trim()
  if (/^(0|[1-9][0-9]*)$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isSafeInteger(seconds)) return GOOGLE_RETRY_MAX_MS
    return Math.min(seconds * 1_000, GOOGLE_RETRY_MAX_MS)
  }
  const atMs = Date.parse(trimmed)
  if (!Number.isFinite(atMs)) return null
  return Math.min(Math.max(0, atMs - nowMs), GOOGLE_RETRY_MAX_MS)
}

export function googleRetryDelayMs(
  input: Readonly<{
    attempt: number
    nowMs: number
    retryAfter: string | null
    jitter: number
  }>,
): number {
  if (
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !Number.isSafeInteger(input.nowMs) ||
    !Number.isFinite(input.jitter) ||
    input.jitter < 0 ||
    input.jitter > 1
  ) {
    throw new Error('provider retry input is invalid')
  }
  const retryAfterMs = parseGoogleRetryAfterMs(input.retryAfter, input.nowMs)
  if (retryAfterMs !== null) {
    return googleRetryFloorMs(retryAfterMs)
  }
  const exponent = Math.min(input.attempt - 1, 16)
  const ceiling = Math.min(GOOGLE_RETRY_MAX_MS, GOOGLE_RETRY_MIN_MS * 2 ** exponent)
  return Math.min(
    GOOGLE_RETRY_MAX_MS,
    Math.max(GOOGLE_RETRY_MIN_MS, Math.ceil(ceiling * input.jitter)),
  )
}
