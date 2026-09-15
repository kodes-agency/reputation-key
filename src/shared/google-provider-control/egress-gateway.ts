import type { VersionedHmacKeyring } from '../security/versioned-hmac-keyring'
import {
  compileGoogleProviderRequest,
  type CompiledGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from './route-catalogue'
import { verifyGoogleAdmissionGrant } from './admission-grant-store'
import { parseGoogleRetryAfterMs } from './provider-call'
import type {
  GoogleAdmissionRedeemResult,
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
 * The error code alone cannot say this: `admission_denied` is reported both
 * before any request and when completion bookkeeping fails after Google
 * answered (see `execute` below), and on 2026-09-14 a request refused by
 * compilation was classified as an ambiguous send.
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

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) {
      throw new Error('response_too_large')
    }
    const declaredBytes = Number(declared)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      await response.body?.cancel()
      throw new Error('response_too_large')
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
        throw new Error('response_too_large')
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

function redemptionAccepted(
  result: GoogleAdmissionRedeemResult,
): result is Extract<GoogleAdmissionRedeemResult, { ok: true }> {
  return result.ok
}

export function createGoogleEgressGateway(
  deps: Readonly<{
    nowMs: () => number
    gatewayIdentity: string
    bindCredential: (credential: string) => string
    routeTarget?: GoogleProviderRouteTarget
    grantKeyring: VersionedHmacKeyring
    admission: Pick<GoogleExecutionAdmissionService, 'start' | 'redeem' | 'complete'>
    fetch: typeof fetch
    /**
     * Optional so existing constructions keep working; without it this behaves
     * exactly as before and simply says nothing.
     */
    logger?: Readonly<{
      warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>
  }>,
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
        gatewayIdentity: deps.gatewayIdentity,
        admission: compiled.admission,
        deadlineMs: input.deadlineMs,
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
            ...(error instanceof Error
              ? { err: { name: error.name, message: error.message } }
              : {}),
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
      if (
        !verifyGoogleAdmissionGrant(started.grant, deps.grantKeyring) ||
        started.grant.gatewayIdentity !== deps.gatewayIdentity ||
        started.grant.permitId !== input.permitId ||
        started.grant.routeKey !== compiled.routeKey ||
        started.grant.routeCatalogueVersion !== compiled.catalogueVersion ||
        started.grant.requestBindingSha256 !== compiled.admission.requestBindingSha256 ||
        started.grant.credentialBinding !== compiled.admission.credentialBinding ||
        started.grant.expiresAtMs <= deps.nowMs()
      ) {
        return notSent('admission_mismatch')
      }
      let redeemed: GoogleAdmissionRedeemResult
      try {
        redeemed = await deps.admission.redeem({
          grant: started.grant,
          gatewayIdentity: deps.gatewayIdentity,
          admission: compiled.admission,
        })
      } catch {
        return notSent('admission_mismatch')
      }
      if (!redemptionAccepted(redeemed)) {
        return notSent('admission_mismatch')
      }

      let outcome: GoogleProviderOutcome = 'caller_abandoned'
      let retryAfterMs: number | null = null
      // What this attempt proves about reaching Google, updated at the two
      // moments that change it: just before `fetch` is invoked (a missing
      // response is now `unknown`) and when a response object arrives
      // (`answered`). Every failure below, including the completion failure
      // after the call, reports it rather than a per-branch guess.
      let evidence: DispatchEvidence = { dispatch: 'not_sent' }
      let result: GoogleEgressGatewayResult | null = null
      try {
        const remainingMs = input.deadlineMs - deps.nowMs()
        if (remainingMs <= 0) {
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
            outcome =
              deps.nowMs() >= input.deadlineMs ? 'deadline_exceeded' : 'transport_error'
            result = {
              ok: false,
              code:
                outcome === 'deadline_exceeded' ? 'deadline_exceeded' : 'transport_error',
              ...evidence,
              retryAfterMs: 0,
            }
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
            } catch {
              outcome = 'response_too_large'
              result = {
                ok: false,
                code: 'response_too_large',
                ...evidence,
                retryAfterMs: 0,
              }
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
      const completed = await deps.admission
        .complete({
          admissionId: started.grant.admissionId,
          outcome,
          retryAfterMs,
        })
        .catch(() => false)
      // The code stays `admission_denied` for existing callers, but once fetch
      // was invoked Google may already have answered (or received) the request,
      // so the evidence reports what happened rather than implying a refusal
      // before dispatch.
      return completed
        ? settled
        : { ok: false, code: 'admission_denied', ...evidence, retryAfterMs: 0 }
    },
  })
}
