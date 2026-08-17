import { parseGoogleRetryAfterMs } from '#/shared/google-provider-control/provider-call'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
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

function gatewayFailureKind(
  code: Exclude<
    Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>,
    { ok: true }
  >['code'],
): GbpApiErrorKind {
  if (code === 'admission_denied') return 'rate_limited'
  if (code === 'response_too_large' || code === 'malformed_request') {
    return 'parse_error'
  }
  return 'upstream_error'
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The provider request was aborted', 'AbortError')
}

async function awaitProviderExecution(
  execution: ReturnType<GoogleAuthorizedProviderExecutor['execute']>,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>> {
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
  Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>,
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
  let result: Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>
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
    throw createGbpApiError(input.operation, gatewayFailureKind(result.code), {
      retryAfterMs: result.retryAfterMs,
    })
  }

  const providerBodyBytes = result.body.byteLength
  try {
    if (result.status !== 200) {
      throw createGbpApiError(input.operation, classifyProviderStatus(result.status), {
        providerBodyBytes,
        retryAfterMs:
          parseGoogleRetryAfterMs(result.headers.retryAfter, input.nowMs()) ?? undefined,
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
