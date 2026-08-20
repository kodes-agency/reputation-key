import { createHash } from 'node:crypto'

export function hashBoundedRequestBody(
  body: Uint8Array,
  maxBytes: number,
): Readonly<{ sha256: string | null; bytes: number }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || body.byteLength > maxBytes) {
    throw new Error('provider request body exceeds its admission bound')
  }
  return {
    sha256:
      body.byteLength === 0 ? null : createHash('sha256').update(body).digest('hex'),
    bytes: body.byteLength,
  }
}

export type ProviderHttpResult<T> = Readonly<{
  status: number
  value: T
}>

/** One initial request plus, only after 401, one authorized refresh and retry. */
export async function executeWithSingle401Refresh<TToken, TResult>(
  input: Readonly<{
    token: TToken
    deadlineMs: number
    nowMs: () => number
    send: (token: TToken, attempt: 1 | 2) => Promise<ProviderHttpResult<TResult>>
    refreshAfter401: () => Promise<TToken>
  }>,
): Promise<ProviderHttpResult<TResult>> {
  if (input.deadlineMs <= input.nowMs()) {
    throw new Error('provider request deadline exceeded')
  }
  const first = await input.send(input.token, 1)
  if (first.status !== 401) return first
  if (input.deadlineMs <= input.nowMs()) {
    throw new Error('provider request deadline exceeded')
  }
  const refreshed = await input.refreshAfter401()
  if (input.deadlineMs <= input.nowMs()) {
    throw new Error('provider request deadline exceeded')
  }
  return input.send(refreshed, 2)
}

const GOOGLE_RETRY_MIN_MS = 5_000
const GOOGLE_RETRY_MAX_MS = 300_000

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

/**
 * Floor an already-parsed retry hint onto the same 5s..300s schedule as
 * `googleRetryDelayMs`. The gateway reports milliseconds rather than a header,
 * and a missing or zero hint must still produce a real wait: surfacing "retry
 * now" told the caller to wait while enabling the action immediately.
 */
export function googleRetryFloorMs(retryAfterMs: number | null): number {
  if (retryAfterMs === null || !Number.isSafeInteger(retryAfterMs)) {
    return GOOGLE_RETRY_MIN_MS
  }
  return Math.min(GOOGLE_RETRY_MAX_MS, Math.max(GOOGLE_RETRY_MIN_MS, retryAfterMs))
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
