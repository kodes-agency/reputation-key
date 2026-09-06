import {
  googleRetryDelayMs,
  googleRetryFloorMs,
  parseGoogleRetryAfterMs,
} from '#/shared/google-provider-control/provider-call'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderAdmissionCode,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGbpApiError, type GbpApiErrorKind } from '../../domain/gbp-api-error'

const PROVIDER_DEADLINE_MS = 15_000
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i

function classifyProviderStatus(status: number): GbpApiErrorKind {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

function admissionFailureKind(
  admissionCode: GoogleProviderAdmissionCode | undefined,
): GbpApiErrorKind {
  switch (admissionCode) {
    // Only real provider quota pressure is rate limiting. Permit/policy fences
    // (elapsed start deadline, coordination outage) all surfaced as "Google is
    // limiting requests" before this, which pointed operators at provider
    // quota instead of our own admission path.
    case 'quota_exhausted':
    case 'in_flight_exhausted':
      return 'rate_limited'
    // The caller's authorization moved while the request was in flight. These
    // are decisions, not outages: reporting them as retryable "temporarily
    // unavailable" hid a real permission change behind a useless retry.
    case 'authorization_changed':
    case 'authorization_denied':
      return 'permission_denied'
    // Everything else — including `policy_refresh_unavailable` — is our own
    // admission path being momentarily unable to decide.
    default:
      return 'upstream_error'
  }
}

type GoogleProviderExecutionFailure = Exclude<GoogleProviderExecutionResult, { ok: true }>

function gatewayFailureKind(failure: GoogleProviderExecutionFailure): GbpApiErrorKind {
  if (failure.code === 'admission_denied') {
    return admissionFailureKind(failure.admissionCode)
  }
  if (failure.code === 'response_too_large' || failure.code === 'malformed_request') {
    return 'parse_error'
  }
  return 'upstream_error'
}

/** Retryable kinds always carry a real wait; the rest carry the raw hint. */
function retryableBackoffMs(
  kind: GbpApiErrorKind,
  hintMs: number | null,
): number | undefined {
  return kind === 'rate_limited' || kind === 'upstream_error'
    ? googleRetryFloorMs(hintMs)
    : (hintMs ?? undefined)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The provider request was aborted', 'AbortError')
}

async function awaitProviderExecution(
  execution: Promise<GoogleProviderExecutionResult>,
  signal?: AbortSignal,
): Promise<GoogleProviderExecutionResult> {
  if (!signal) return execution
  if (signal.aborted) throw abortReason(signal)

  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      void execution.then(
        (late) => {
          if (late.ok) late.body.fill(0)
        },
        () => undefined,
      )
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void execution.then(
      (result) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export type GoogleProviderSuccessfulResponse = Extract<
  GoogleProviderExecutionResult,
  { ok: true }
>

export async function executeGoogleProviderRaw(
  input: Readonly<{
    operation: string
    descriptor: GoogleProviderRouteDescriptor
    authorization: GoogleProviderCallAuthorization
    executor: GoogleAuthorizedProviderExecutor
    nowMs: () => number
    signal?: AbortSignal
  }>,
): Promise<GoogleProviderSuccessfulResponse> {
  if (input.signal?.aborted) throw abortReason(input.signal)
  const startedAtMs = input.nowMs()
  if (!Number.isSafeInteger(startedAtMs)) {
    throw createGbpApiError(input.operation, 'upstream_error')
  }
  let result: GoogleProviderExecutionResult
  const requestController = new AbortController()
  const abortFromCaller = () => requestController.abort(abortReason(input.signal!))
  input.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const deadlineTimer = setTimeout(
    () =>
      requestController.abort(
        new DOMException('The provider request deadline elapsed', 'TimeoutError'),
      ),
    PROVIDER_DEADLINE_MS,
  )

  try {
    result = await awaitProviderExecution(
      input.executor.execute(input.descriptor, {
        authorization: input.authorization,
        deadlineMs: startedAtMs + PROVIDER_DEADLINE_MS,
        signal: requestController.signal,
      }),
      requestController.signal,
    )
  } catch {
    if (input.signal?.aborted) throw abortReason(input.signal)
    throw createGbpApiError(input.operation, 'upstream_error')
  } finally {
    clearTimeout(deadlineTimer)
    input.signal?.removeEventListener('abort', abortFromCaller)
  }

  if (!result.ok) {
    const gatewayKind = gatewayFailureKind(result)
    throw createGbpApiError(input.operation, gatewayKind, {
      retryAfterMs: retryableBackoffMs(gatewayKind, result.retryAfterMs),
    })
  }

  const providerBodyBytes = result.body.byteLength
  try {
    if (result.status !== 200) {
      const statusKind = classifyProviderStatus(result.status)
      const observedAtMs = input.nowMs()
      throw createGbpApiError(input.operation, statusKind, {
        providerBodyBytes,
        // A 429 with no Retry-After previously produced no wait at all, so the
        // caller was told to wait while its retry control stayed enabled.
        retryAfterMs:
          statusKind === 'rate_limited' || statusKind === 'upstream_error'
            ? googleRetryDelayMs({
                attempt: 1,
                nowMs: Number.isSafeInteger(observedAtMs) ? observedAtMs : startedAtMs,
                retryAfter: result.headers.retryAfter,
                jitter: 1,
              })
            : (parseGoogleRetryAfterMs(result.headers.retryAfter, observedAtMs) ??
              undefined),
      })
    }
    if (
      result.headers.contentType === null ||
      !JSON_CONTENT_TYPE.test(result.headers.contentType)
    ) {
      throw createGbpApiError(input.operation, 'parse_error', {
        providerBodyBytes,
      })
    }
    return result
  } catch (error) {
    result.body.fill(0)
    throw error
  }
}

export async function executeGoogleProviderJson(
  input: Readonly<{
    operation: string
    descriptor: GoogleProviderRouteDescriptor
    executor: GoogleAuthorizedProviderExecutor
    authorization: GoogleProviderCallAuthorization
    nowMs: () => number
    signal?: AbortSignal
  }>,
): Promise<unknown> {
  const result = await executeGoogleProviderRaw(input)
  const providerBodyBytes = result.body.byteLength
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(result.body)
    return JSON.parse(decoded)
  } catch {
    throw createGbpApiError(input.operation, 'parse_error', {
      providerBodyBytes,
    })
  } finally {
    result.body.fill(0)
  }
}
