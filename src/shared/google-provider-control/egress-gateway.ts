import { summarizeError } from '#/shared/observability/error-summary'
import {
  compileGoogleProviderRequest,
  type CompiledGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from './route-catalogue'
import { parseGoogleRetryAfterMs } from './provider-call'
import type {
  GoogleAdmissionHandle,
  GoogleAdmissionStartInput,
  GoogleAdmissionStartResult,
  GoogleExecutionAdmissionService,
  GoogleProviderOutcome,
} from './admission-service'

export type GoogleEgressGatewayRequest = Readonly<{
  permitId: string
  descriptor: GoogleProviderRouteDescriptor
  deadlineMs: number
}>

/**
 * What a failed provider call proves about the request reaching Google.
 *
 * - `not_sent`: `fetch` was never called for this call. The only value that is
 *   positive evidence a write did not happen, so the only one a caller may use
 *   to treat a failed write as safe to send again.
 * - `answered`: Google returned a response (its status is `providerStatus`).
 * - `unknown`: `fetch` was called and no response was observed (it threw, was
 *   aborted, or the caller stopped waiting). Google may have acted on it.
 *
 */
export type GoogleProviderDispatch = 'not_sent' | 'answered' | 'unknown'

export type GoogleEgressGatewayResult =
  | Readonly<{
      ok: true
      status: number
      headers: Readonly<{
        contentType: string | null
        cacheControl: string | null
        retryAfter: string | null
      }>
      body: Uint8Array
    }>
  | Readonly<{
      ok: false
      code:
        | 'malformed_request'
        | 'admission_denied'
        | 'admission_mismatch'
        | 'deadline_exceeded'
        | 'transport_error'
        | 'response_too_large'
      /**
       * Content-free execution-admission denial reason. Present only for
       * `admission_denied`, so callers can separate genuine provider quota
       * pressure (`quota_exhausted` / `in_flight_exhausted`) from permit and
       * policy fences, which are not rate limiting.
       */
      admissionCode?: AdmissionDenialCode
      dispatch: GoogleProviderDispatch
      /** The provider's HTTP status; present only when `dispatch` is `answered`. */
      providerStatus?: number
      retryAfterMs: number
    }>

export type AdmissionDenialCode = Extract<
  GoogleAdmissionStartResult,
  { ok: false }
>['code']

export type GoogleEgressGateway = Readonly<{
  execute(input: GoogleEgressGatewayRequest): Promise<GoogleEgressGatewayResult>
}>

const SAFE_PERMIT_ID = /^[A-Za-z0-9._:@/-]{1,255}$/

/**
 * The one reason `readBoundedResponse` rejects a response by size. Any other
 * failure while reading is the connection or the deadline, not the body's size.
 */
class ResponseTooLargeError extends Error {
  constructor() {
    super('response_too_large')
    this.name = 'ResponseTooLargeError'
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) {
      throw new ResponseTooLargeError()
    }
    const declaredBytes = Number(declared)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await response.body?.cancel()
      throw new ResponseTooLargeError()
    }
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new ResponseTooLargeError()
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

type GatewayFailure = Extract<GoogleEgressGatewayResult, { ok: false }>
type DispatchEvidence = Pick<GatewayFailure, 'dispatch' | 'providerStatus'>

/** A refusal decided before `fetch` was invoked for this call. */
function notSent(code: GatewayFailure['code']): GatewayFailure {
  return { ok: false, code, dispatch: 'not_sent', retryAfterMs: 0 }
}

function providerOutcome(status: number): GoogleProviderOutcome {
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'provider_5xx'
  if (status >= 400) return 'provider_4xx'
  return 'success'
}

function admissionAccepted(
  result: GoogleAdmissionStartResult,
): result is Extract<GoogleAdmissionStartResult, { ok: true }> {
  return result.ok
}

type GatewayLogger = Readonly<{
  warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
}>

type CompletionAttempt = Readonly<{ completed: boolean; error?: unknown }>

async function waitForPermitCompletion(
  handle: GoogleAdmissionHandle,
  completion: Promise<void>,
  budgetMs: number,
): Promise<void> {
  if (budgetMs <= 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      handle.permitCompletion,
      completion,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Retry bookkeeping only; never repeat the provider request. */
async function completeAdmission(
  handle: GoogleAdmissionHandle,
  logger: GatewayLogger | undefined,
  input: Readonly<{
    routeKey: string
    outcome: GoogleProviderOutcome
    retryAfterMs: number | null
    evidence: DispatchEvidence
  }>,
): Promise<void> {
  let attempt: CompletionAttempt = { completed: false }
  for (let remaining = 3; remaining > 0; remaining--) {
    attempt = await handle
      .complete({
        outcome: input.outcome,
        retryAfterMs: input.retryAfterMs,
      })
      .then(
        (completed): CompletionAttempt => ({ completed }),
        (error: unknown): CompletionAttempt => ({ completed: false, error }),
      )
    if (attempt.completed) return
  }
  logger?.warn(
    {
      surface: 'google-egress-gateway',
      stage: 'admission-complete',
      routeKey: input.routeKey,
      outcome: input.outcome,
      ...input.evidence,
      ...(attempt.error instanceof Error ? { err: summarizeError(attempt.error) } : {}),
    },
    'Google admission completion failed',
  )
}

type GatewayDependencies = Readonly<{
  nowMs: () => number
  bindCredential: (credential: string) => string
  routeTarget?: GoogleProviderRouteTarget
  admission: GoogleExecutionAdmissionService
  fetch: typeof fetch
  /**
   * Optional so existing constructions keep working; without it this behaves
   * exactly as before and simply says nothing.
   */
  logger?: GatewayLogger
}>

async function executeAdmittedRequest(
  deps: GatewayDependencies,
  compiled: CompiledGoogleProviderRequest,
  handle: GoogleAdmissionHandle,
  deadlineMs: number,
): Promise<GoogleEgressGatewayResult> {
  /** What an aborted or failed exchange is: the deadline, or the transport. */
  const interruptedOutcome = (): 'deadline_exceeded' | 'transport_error' =>
    deps.nowMs() >= deadlineMs ? 'deadline_exceeded' : 'transport_error'
  let outcome: GoogleProviderOutcome = 'caller_abandoned'
  let retryAfterMs: number | null = null
  // What this attempt proves about reaching Google, updated at the two
  // moments that change it: just before `fetch` is invoked (a missing
  // response is now `unknown`) and when a response object arrives
  // (`answered`). Each failure keeps that evidence.
  let evidence: DispatchEvidence = { dispatch: 'not_sent' }
  let result: GoogleEgressGatewayResult | null = null
  try {
    const dispatchAtMs = deps.nowMs()
    const remainingMs = deadlineMs - dispatchAtMs
    if (remainingMs <= 0 || handle.expiresAtMs <= dispatchAtMs) {
      outcome = 'deadline_exceeded'
      result = notSent('deadline_exceeded')
    } else {
      let response: Response | null = null
      try {
        const init: RequestInit = {
          method: compiled.method,
          headers: compiled.headers,
          body: compiled.body === null ? null : Buffer.from(compiled.body),
          redirect: 'error',
          signal: AbortSignal.timeout(remainingMs),
        }
        evidence = { dispatch: 'unknown' }
        response = await deps.fetch(compiled.url, init)
      } catch {
        outcome = interruptedOutcome()
        result = { ok: false, code: outcome, ...evidence, retryAfterMs: 0 }
      }
      if (response) {
        evidence = { dispatch: 'answered', providerStatus: response.status }
        outcome = providerOutcome(response.status)
        retryAfterMs = parseGoogleRetryAfterMs(
          response.headers.get('retry-after'),
          deps.nowMs(),
        )
        try {
          const body = await readBoundedResponse(
            response,
            compiled.admission.maxResponseBytes,
          )
          result = {
            ok: true,
            status: response.status,
            headers: Object.freeze({
              contentType: response.headers.get('content-type'),
              cacheControl: response.headers.get('cache-control'),
              retryAfter: response.headers.get('retry-after'),
            }),
            body,
          }
        } catch (error) {
          // Google answered; the body is what failed. Only a size verdict is
          // `response_too_large`: a reset or the deadline firing mid-body is
          // the fault it was, with the answered evidence kept.
          outcome =
            error instanceof ResponseTooLargeError
              ? 'response_too_large'
              : interruptedOutcome()
          result = { ok: false, code: outcome, ...evidence, retryAfterMs: 0 }
        }
      }
    }
  } catch {
    outcome = 'transport_error'
    result = { ok: false, code: 'transport_error', ...evidence, retryAfterMs: 0 }
  }
  // `fetch` resolving to nothing leaves no branch assigned; the evidence
  // still says the call was made.
  const settled = result ?? {
    ok: false,
    code: 'transport_error',
    ...evidence,
    retryAfterMs: 0,
  }
  const completion = completeAdmission(handle, deps.logger, {
    routeKey: compiled.admission.routeKey,
    outcome,
    retryAfterMs,
    evidence,
  })
  // Let a healthy authority record the outcome before returning. Slow bookkeeping
  // continues in the background, leaving at least half the caller's remaining time.
  await waitForPermitCompletion(
    handle,
    completion,
    Math.min(1_000, Math.floor((deadlineMs - deps.nowMs()) / 2)),
  )
  return settled
}

export function createGoogleEgressGateway(
  deps: GatewayDependencies,
): GoogleEgressGateway {
  return Object.freeze({
    execute: async (input) => {
      const nowMs = deps.nowMs()
      if (
        !SAFE_PERMIT_ID.test(input.permitId) ||
        !Number.isSafeInteger(input.deadlineMs) ||
        input.deadlineMs > nowMs + 60_000
      ) {
        return notSent('malformed_request')
      }
      // Elapsed time, not a malformed request: the executor spends this same
      // deadline on credential admission and permit issuance first. The reply
      // workflow stops retrying `malformed_request` as deterministic
      // (reply-publication-workflow.ts classifyByDispatch).
      if (input.deadlineMs <= nowMs) return notSent('deadline_exceeded')
      let compiled: CompiledGoogleProviderRequest
      try {
        compiled = compileGoogleProviderRequest(
          input.descriptor,
          deps.bindCredential,
          deps.routeTarget,
        )
      } catch {
        return notSent('malformed_request')
      }
      const admissionInput: GoogleAdmissionStartInput = Object.freeze({
        permitId: input.permitId,
        admission: compiled.admission,
        deadlineMs: input.deadlineMs,
      })
      // Where a refusal's time went: what the caller left the gateway, and how
      // much of it admission spent (#946: a refresh refused 12 s after its
      // permit, with no record of which side the time was lost on).
      const timing = (): Readonly<{ deadlineLeftMs: number; admissionMs: number }> => ({
        deadlineLeftMs: input.deadlineMs - nowMs,
        admissionMs: deps.nowMs() - nowMs,
      })
      let started: GoogleAdmissionStartResult
      try {
        started = await deps.admission.start(admissionInput)
      } catch (error) {
        // Everything that can go wrong reaching admission — TLS, socket,
        // HTTP status, response schema, timeout — arrives here and leaves as
        // one indistinguishable code. On 2026-09-02 that code was reported for
        // hours while the real cause was a Redis ACL denying the quota script
        // inside the admission service; neither side logged anything, so the
        // failing hop was invisible from both ends. The response is unchanged
        // (the caller must not learn why), but the operator gets the reason.
        deps.logger?.warn(
          {
            surface: 'google-egress-gateway',
            stage: 'admission-start',
            code: 'coordination_unavailable',
            routeKey: compiled.admission.routeKey,
            ...timing(),
            ...(error instanceof Error ? { err: summarizeError(error) } : {}),
          },
          'Google admission call failed',
        )
        return {
          ok: false,
          code: 'admission_denied',
          admissionCode: 'coordination_unavailable',
          dispatch: 'not_sent',
          retryAfterMs: 0,
        }
      }
      if (!admissionAccepted(started)) {
        // A refusal the admission service actually decided, as opposed to one
        // it never received. Recording which is which is the difference
        // between "the hop is broken" and "the request was denied".
        deps.logger?.warn(
          {
            surface: 'google-egress-gateway',
            stage: 'admission-start',
            code: started.code,
            routeKey: compiled.admission.routeKey,
            retryAfterMs: started.retryAfterMs,
            ...timing(),
          },
          'Google admission denied',
        )
        return {
          ok: false,
          code: 'admission_denied',
          admissionCode: started.code,
          dispatch: 'not_sent',
          retryAfterMs: started.retryAfterMs,
        }
      }
      return executeAdmittedRequest(deps, compiled, started.handle, input.deadlineMs)
    },
  })
}
