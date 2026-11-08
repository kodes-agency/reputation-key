import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { GoogleExecutionPermitAdmissionCode } from '#/shared/auth/google-execution-permit-issuer'
import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderRouteKey } from '#/shared/google-provider-control/contracts'
import {
  googleRetryDelayMs,
  googleRetryFloorMs,
  parseGoogleRetryAfterMs,
} from '#/shared/google-provider-control/provider-call'
import { googleProviderErrorStatus } from '#/shared/domain/google-provider-failure'
import {
  isGoogleDisconnectRevokeAuthorization,
  type GoogleDisconnectRevokeAuthorization,
  type GoogleProviderCallAuthorization,
} from '../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderAdmissionCode,
  GoogleProviderPermitAdmissionCode,
  GoogleProviderExecutionResult,
} from '../application/ports/google-authorized-provider-executor.port'
import type { GoogleDisconnectRevokeDispatchHooks } from '../application/google-disconnect-revoke'
import { isIntegrationError } from '../domain/errors'
import { createGbpApiError, type GbpApiErrorKind } from '../domain/gbp-api-error'
import {
  googleCallErrorCodeForExecution,
  googleCallErrorCodeForStatus,
} from '../domain/google-call-error'

/**
 * Total map from the permit issuer's deny union onto the closed set the
 * executor seam forwards. Infrastructure owns this narrowing because the
 * application layer may not import `shared/auth`; being total means a new
 * issuer code fails the build here instead of silently arriving at the UI as a
 * retryable `upstream_error`.
 */
const PERMIT_ADMISSION_CODES: Readonly<
  Record<GoogleExecutionPermitAdmissionCode, GoogleProviderPermitAdmissionCode>
> = {
  capability_killed: 'capability_killed',
  authorization_denied: 'authorization_denied',
  authorization_changed: 'authorization_changed',
}

export function permitAdmissionCode(
  code: GoogleExecutionPermitAdmissionCode,
): GoogleProviderPermitAdmissionCode {
  return PERMIT_ADMISSION_CODES[code]
}

export type GoogleProviderPermitAdmission = Readonly<{
  authorization: GoogleProviderCallAuthorization
  admission: GoogleProviderAdmissionMetadata
}>

/**
 * The app-side permit issuer denies with a closed, content-free code set.
 * Collapsing it to a bare string erases the difference between an authorization
 * change and a transient outage, so the executor forwards the exact code.
 */
export type GoogleProviderPermitAdmitter = (
  input: GoogleProviderPermitAdmission,
) => Promise<
  | Readonly<{ ok: true; permitId: string }>
  | Readonly<{ ok: false; code: GoogleProviderAdmissionCode }>
>

type GoogleEgressGatewayClient = Readonly<{
  execute(
    input: Readonly<{
      permitId: string
      descriptor: GoogleProviderRouteDescriptor
      deadlineMs: number
    }>,
  ): Promise<GoogleProviderExecutionResult>
}>

type ExecuteOptions = Parameters<GoogleAuthorizedProviderExecutor['execute']>[1]
type ExecutionDenial = Extract<GoogleProviderExecutionResult, { ok: false }>

const REJECTION_MESSAGE = 'Google provider execution rejected'

// Every denial this adapter decides on its own happens before the gateway is
// asked to send anything, so each is positive evidence of non-dispatch. Only a
// gateway call can change that, and its own result carries its own evidence.
const deadlineExceeded = (): ExecutionDenial => ({
  ok: false,
  code: 'deadline_exceeded',
  dispatch: 'not_sent',
  retryAfterMs: 0,
})

const denyAdmission = (admissionCode?: GoogleProviderAdmissionCode): ExecutionDenial => ({
  ok: false,
  code: 'admission_denied',
  ...(admissionCode === undefined ? {} : { admissionCode }),
  dispatch: 'not_sent',
  retryAfterMs: 0,
})

const malformedRequest = (): ExecutionDenial => ({
  ok: false,
  code: 'malformed_request',
  dispatch: 'not_sent',
  retryAfterMs: 0,
})

export const createGoogleAuthorizedProviderExecutor = (
  deps: Readonly<{
    bindCredential: (credential: string) => string
    admit: GoogleProviderPermitAdmitter
    gateway: GoogleEgressGatewayClient
    disconnectRevoke?: GoogleDisconnectRevokeDispatchHooks
    now?: () => Date
    /** Re-proves connection liveness immediately before permit issuance. */
    admitCredentialExecution?: (
      input: Readonly<{
        routeKey: GoogleProviderRouteDescriptor['routeKey']
        authorization: GoogleProviderCallAuthorization
      }>,
    ) => Promise<boolean>
    routeTarget?: GoogleProviderRouteTarget
    logger?: Readonly<{
      warn(fields: Readonly<Record<string, unknown>>, message: string): void
    }>
  }>,
): GoogleAuthorizedProviderExecutor => {
  const warnRejected = (
    routeKey: GoogleProviderRouteDescriptor['routeKey'],
    stage: string,
    code: string,
  ): void => {
    deps.logger?.warn({ routeKey, stage, code }, REJECTION_MESSAGE)
  }

  const credentialDenial = async (
    descriptor: GoogleProviderRouteDescriptor,
    options: ExecuteOptions,
  ): Promise<ExecutionDenial | null> => {
    if (!deps.admitCredentialExecution) return null
    let admitted: boolean
    try {
      admitted = await deps.admitCredentialExecution({
        routeKey: descriptor.routeKey,
        authorization: options.authorization,
      })
    } catch {
      admitted = false
    }
    if (admitted) return null
    warnRejected(descriptor.routeKey, 'credential', 'credential_unavailable')
    return denyAdmission('credential_unavailable')
  }

  /** Null means the descriptor could not be compiled into an admissible request. */
  const compileAdmission = (
    descriptor: GoogleProviderRouteDescriptor,
  ): GoogleProviderAdmissionMetadata | null => {
    try {
      return compileGoogleProviderRequest(
        descriptor,
        deps.bindCredential,
        deps.routeTarget,
      ).admission
    } catch {
      warnRejected(descriptor.routeKey, 'compile', 'malformed_request')
      return null
    }
  }

  const prepareDisconnectRevokeDenial = async (
    descriptor: GoogleProviderRouteDescriptor,
    authorization: GoogleDisconnectRevokeAuthorization,
    admission: GoogleProviderAdmissionMetadata,
  ): Promise<ExecutionDenial | null> => {
    const disconnectRevoke = authorization.disconnectRevoke
    if (
      descriptor.routeKey !== 'oauth.revoke' ||
      !deps.disconnectRevoke ||
      !Number.isSafeInteger(disconnectRevoke.cleanupDeadlineAtMs)
    ) {
      return denyAdmission()
    }
    const prepared = await deps.disconnectRevoke.prepare({
      attemptId: disconnectRevoke.attemptId,
      authorization,
      credentialBinding: admission.credentialBinding,
      cleanupDeadlineAt: new Date(disconnectRevoke.cleanupDeadlineAtMs),
      now: deps.now?.() ?? new Date(),
    })
    return prepared.ok ? null : denyAdmission()
  }

  const acquireDisconnectDispatchDenial = async (
    authorization: GoogleDisconnectRevokeAuthorization,
    admission: GoogleProviderAdmissionMetadata,
    permitId: string,
  ): Promise<ExecutionDenial | null> => {
    const acquired = await deps.disconnectRevoke!.acquireDispatch({
      attemptId: authorization.disconnectRevoke.attemptId,
      cleanupWorkPermitId: permitId,
      authorization,
      credentialBinding: admission.credentialBinding,
      now: deps.now?.() ?? new Date(),
    })
    return acquired.ok ? null : denyAdmission()
  }

  const admitPermit = async (
    descriptor: GoogleProviderRouteDescriptor,
    options: ExecuteOptions,
    admission: GoogleProviderAdmissionMetadata,
  ): Promise<Readonly<{ ok: true; permitId: string }> | ExecutionDenial> => {
    let permit: Awaited<ReturnType<GoogleProviderPermitAdmitter>>
    try {
      permit = await deps.admit({ authorization: options.authorization, admission })
    } catch {
      warnRejected(descriptor.routeKey, 'admit', 'admission_error')
      return denyAdmission()
    }
    if (!permit.ok) {
      warnRejected(descriptor.routeKey, 'admit', permit.code)
      return denyAdmission(permit.code)
    }
    return permit
  }

  const runGateway = async (
    descriptor: GoogleProviderRouteDescriptor,
    options: ExecuteOptions,
    permitId: string,
  ): Promise<GoogleProviderExecutionResult> => {
    try {
      const executed = await deps.gateway.execute({
        permitId,
        descriptor,
        deadlineMs: options.deadlineMs,
      })
      if (!executed.ok) {
        // Keep policy and permit fences distinguishable from quota pressure.
        deps.logger?.warn(
          {
            routeKey: descriptor.routeKey,
            stage: 'gateway',
            code: executed.code,
            ...(executed.admissionCode === undefined
              ? {}
              : { admissionCode: executed.admissionCode }),
            dispatch: executed.dispatch,
            ...(executed.providerStatus === undefined
              ? {}
              : { providerStatus: executed.providerStatus }),
            retryAfterMs: executed.retryAfterMs,
          },
          REJECTION_MESSAGE,
        )
      }
      return executed
    } catch {
      // The gateway may already have invoked fetch before it threw; nothing
      // here proves otherwise.
      warnRejected(descriptor.routeKey, 'gateway', 'transport_error')
      return { ok: false, code: 'transport_error', dispatch: 'unknown', retryAfterMs: 0 }
    }
  }

  return Object.freeze({
    execute: async (descriptor, options) => {
      if (options.signal?.aborted) return deadlineExceeded()

      const credentialAdmissionDenial = await credentialDenial(descriptor, options)
      if (credentialAdmissionDenial) return credentialAdmissionDenial

      const admission = compileAdmission(descriptor)
      if (!admission) return malformedRequest()

      const disconnectAuthorization = isGoogleDisconnectRevokeAuthorization(
        options.authorization,
      )
        ? options.authorization
        : null
      if (disconnectAuthorization?.disconnectRevoke) {
        const denial = await prepareDisconnectRevokeDenial(
          descriptor,
          disconnectAuthorization,
          admission,
        )
        if (denial) return denial
      }

      const permit = await admitPermit(descriptor, options, admission)
      if (!permit.ok) return permit

      if (disconnectAuthorization?.disconnectRevoke) {
        const denial = await acquireDisconnectDispatchDenial(
          disconnectAuthorization,
          admission,
          permit.permitId,
        )
        if (denial) return denial
      }

      if (options.signal?.aborted) return deadlineExceeded()
      return runGateway(descriptor, options, permit.permitId)
    },
  })
}

export type GoogleProviderCredentialAdmission = (
  input: Readonly<{
    routeKey: GoogleProviderRouteKey
    authorization: GoogleProviderCallAuthorization
  }>,
) => Promise<boolean>

type AdmissionRow = Readonly<{
  status: string
  credential_use_state: string
  lifecycle_version: number
  access_version: number
  credential_generation: number
}>

const RECONNECTABLE_STATUS: Readonly<Record<string, true>> = {
  active: true,
  degraded: true,
  reauth_required: true,
  disconnected: true,
}
const RECONNECTABLE_USE_STATE: Readonly<Record<string, true>> = {
  active: true,
  none: true,
}

function vectorMatchesConnection(
  authorization: GoogleProviderCallAuthorization,
  row: AdmissionRow,
): boolean {
  const vector = authorization.authorizationVector
  return (
    vector.connectionLifecycleVersion === row.lifecycle_version &&
    vector.connectionAccessVersion === row.access_version &&
    vector.credentialGeneration === row.credential_generation &&
    authorization.expectedCredentialGeneration === row.credential_generation
  )
}

/**
 * Last-mile credential liveness check immediately before permit issuance.
 * The single deployment owns every connection, so admission depends only on
 * the connection's current lifecycle, access, and credential generations.
 */
export const createGoogleProviderCredentialAdmission = (
  db: Pick<Database, 'execute'>,
): GoogleProviderCredentialAdmission => {
  return async (input) => {
    const authorization = input.authorization
    const result = await db.execute(sql`
      SELECT status, credential_use_state, lifecycle_version,
             access_version, credential_generation
      FROM google_connections
      WHERE organization_id = ${authorization.organizationId}
        AND id = ${authorization.connectionId}::uuid
      LIMIT 1
    `)
    const row = result.rows[0] as AdmissionRow | undefined
    const vector = authorization.authorizationVector
    const oauthExchange =
      input.routeKey === 'oauth.token.exchange' &&
      authorization.capability === 'property.import_gbp_v2' &&
      authorization.propertyId === null &&
      authorization.initiatorUserId !== null

    if (oauthExchange && vector.oauthCredentialOperation === 'exchange_new') {
      return (
        row === undefined &&
        authorization.expectedCredentialGeneration === 0 &&
        vector.credentialGeneration === 0
      )
    }
    if (!row || !vectorMatchesConnection(authorization, row)) return false

    if (oauthExchange && vector.oauthCredentialOperation === 'exchange_existing') {
      return (
        RECONNECTABLE_STATUS[row.status] === true &&
        RECONNECTABLE_USE_STATE[row.credential_use_state] === true &&
        vector.connectionStatus === row.status &&
        vector.credentialUseState === row.credential_use_state
      )
    }

    return row.status === 'active' && row.credential_use_state === 'active'
  }
}

export const createSingle401RefreshExecutor = (
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    refreshAccessToken: (
      input: Readonly<{
        authorization: GoogleProviderCallAuthorization
      }>,
    ) => Promise<unknown>
    getAccessToken: (
      input: Readonly<{
        authorization: GoogleProviderCallAuthorization
      }>,
    ) => Promise<string>
    reauthorize: (
      input: Readonly<{
        authorization: GoogleProviderCallAuthorization
      }>,
    ) => Promise<GoogleProviderCallAuthorization>
  }>,
): GoogleAuthorizedProviderExecutor => {
  const sameScope = (
    current: GoogleProviderCallAuthorization,
    refreshed: GoogleProviderCallAuthorization,
  ): boolean =>
    current.capability === refreshed.capability &&
    current.organizationId === refreshed.organizationId &&
    current.propertyId === refreshed.propertyId &&
    current.connectionId === refreshed.connectionId &&
    current.initiatorUserId === refreshed.initiatorUserId

  return Object.freeze({
    execute: async (descriptor, options) => {
      const first = await deps.executor.execute(descriptor, options)
      if (!first.ok || first.status !== 401 || !('accessToken' in descriptor))
        return first
      first.body.fill(0)
      // Coalescing and backoff belong to refreshGoogleToken's Redis
      // coordination port so every replica observes the same refresh.
      try {
        await deps.refreshAccessToken({ authorization: options.authorization })
      } catch (error) {
        // Google refused the grant for good, so the answered 401 is the whole
        // outcome. Rethrowing would report it as an unknown dispatch.
        if (isIntegrationError(error) && error.code === 'reauthorization_required') {
          return first
        }
        throw error
      }
      options.signal?.throwIfAborted()
      const authorization = await deps.reauthorize({
        authorization: options.authorization,
      })
      options.signal?.throwIfAborted()
      if (!sameScope(options.authorization, authorization)) {
        throw new Error('refreshed Google authorization scope changed')
      }
      const accessToken = await deps.getAccessToken({ authorization })
      options.signal?.throwIfAborted()
      if (accessToken.length < 1 || accessToken.length > 8_192) {
        throw new Error('refreshed Google access token is invalid')
      }
      const retried = await deps.executor.execute(
        Object.freeze({ ...descriptor, accessToken }),
        Object.freeze({ ...options, authorization }),
      )
      // The first execution already reached Google and was answered 401, so a
      // retry refused before its own fetch (quota, coordination, mismatch) must
      // not report the call as `not_sent`: that value alone lets the reply
      // workflow treat a failed write as safe to send again
      // (reply-publication-workflow.ts classifyByDispatch). The answered 401
      // is what this call proves.
      return !retried.ok && retried.dispatch === 'not_sent'
        ? Object.freeze({ ...retried, dispatch: 'answered', providerStatus: 401 })
        : retried
    },
  })
}

type GoogleProviderRequest = Readonly<{
  operation: string
  descriptor: GoogleProviderRouteDescriptor
  authorization: GoogleProviderCallAuthorization
  executor: GoogleAuthorizedProviderExecutor
  nowMs: () => number
  signal?: AbortSignal
}>

const PROVIDER_DEADLINE_MS = 15_000
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i

type GoogleProviderExecutionFailure = Exclude<GoogleProviderExecutionResult, { ok: true }>

/**
 * The typed error for an execution the gateway refused or could not finish. It
 * keeps the gateway's evidence — whether the request could have reached Google,
 * the execution code, and Google's status when it answered — so a caller never
 * reads a write that may have happened as one that did not.
 */
export function gatewayFailureError(
  operation: string,
  failure: GoogleProviderExecutionFailure,
) {
  const gatewayKind = googleCallErrorCodeForExecution(failure)
  return createGbpApiError(operation, gatewayKind, {
    retryAfterMs: retryableBackoffMs(gatewayKind, failure.retryAfterMs),
    ...(failure.code === 'admission_denied' && failure.admissionCode !== undefined
      ? { executionAdmissionCode: failure.admissionCode }
      : {}),
    dispatch: failure.dispatch,
    executionCode: failure.code,
    ...(failure.providerStatus === undefined
      ? {}
      : { providerStatus: failure.providerStatus }),
  })
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

function decodeProviderJson(body: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
}

function machineStatus(body: Uint8Array) {
  try {
    const parsed = decodeProviderJson(body)
    const error =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? parsed.error
        : null
    return googleProviderErrorStatus(
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : null,
    )
  } catch {
    return null
  }
}

/**
 * The typed error for a provider answer that is not a 200. A rate limit or an
 * upstream failure always carries a real wait (`Retry-After`, or the schedule's
 * floor); the callers that decide what to do with the status itself, like the
 * single-review read that treats a 404 as an answer, share this mapping instead
 * of re-deriving it.
 */
export function providerStatusError(
  operation: string,
  response: GoogleProviderSuccessfulResponse,
  nowMs: () => number,
  startedAtMs: number,
) {
  const statusKind = googleCallErrorCodeForStatus(response.status)
  const observedAtMs = nowMs()
  return createGbpApiError(operation, statusKind, {
    providerBodyBytes: response.body.byteLength,
    dispatch: 'answered',
    providerStatus: response.status,
    providerErrorStatus: machineStatus(response.body),
    // Rate limits and upstream failures need a wait even without Retry-After.
    retryAfterMs:
      statusKind === 'rate_limited' || statusKind === 'upstream_error'
        ? googleRetryDelayMs({
            attempt: 1,
            nowMs: Number.isSafeInteger(observedAtMs) ? observedAtMs : startedAtMs,
            retryAfter: response.headers.retryAfter,
            jitter: 1,
          })
        : (parseGoogleRetryAfterMs(response.headers.retryAfter, observedAtMs) ??
          undefined),
  })
}

export async function executeGoogleProviderRaw(
  input: GoogleProviderRequest,
): Promise<GoogleProviderSuccessfulResponse> {
  if (input.signal?.aborted) throw abortReason(input.signal)
  const startedAtMs = input.nowMs()
  if (!Number.isSafeInteger(startedAtMs)) {
    // Refused before the executor exists for this call: nothing was sent.
    throw createGbpApiError(input.operation, 'upstream_error', { dispatch: 'not_sent' })
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
    // The executor threw, or the adapter deadline fired while it was still
    // running. The gateway does not observe this abort signal, so the request
    // may still have left (or leave) after we stopped waiting.
    throw createGbpApiError(input.operation, 'upstream_error', { dispatch: 'unknown' })
  } finally {
    clearTimeout(deadlineTimer)
    input.signal?.removeEventListener('abort', abortFromCaller)
  }

  if (!result.ok) throw gatewayFailureError(input.operation, result)

  const providerBodyBytes = result.body.byteLength
  try {
    if (result.status !== 200) {
      throw providerStatusError(input.operation, result, input.nowMs, startedAtMs)
    }
    if (
      result.headers.contentType === null ||
      !JSON_CONTENT_TYPE.test(result.headers.contentType)
    ) {
      // Google answered 200; only the representation is unusable here.
      throw createGbpApiError(input.operation, 'parse_error', {
        providerBodyBytes,
        dispatch: 'answered',
        providerStatus: result.status,
      })
    }
    return result
  } catch (error) {
    result.body.fill(0)
    throw error
  }
}

export async function executeGoogleProviderJson(
  input: GoogleProviderRequest,
): Promise<unknown> {
  const result = await executeGoogleProviderRaw(input)
  const providerBodyBytes = result.body.byteLength
  try {
    return decodeProviderJson(result.body)
  } catch {
    throw createGbpApiError(input.operation, 'parse_error', {
      providerBodyBytes,
      dispatch: 'answered',
      providerStatus: result.status,
    })
  } finally {
    result.body.fill(0)
  }
}
