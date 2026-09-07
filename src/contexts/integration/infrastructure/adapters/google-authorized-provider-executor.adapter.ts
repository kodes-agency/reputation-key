import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from '#/shared/google-provider-control/route-catalogue'
import type {
  GoogleDisconnectRevokeAuthorization,
  GoogleProviderCallAuthorization,
} from '../../application/google-provider-contract'
import { isGoogleDisconnectRevokeAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderAdmissionCode,
  GoogleProviderAuthorityAdmissionCode,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleContentAuthorityDenyCode } from '#/shared/auth/google-content-authority'
import type { GoogleDisconnectRevokeDispatchHooks } from '../../application/google-disconnect-revoke'

/**
 * Total map from the content authority's own deny union onto the closed set the
 * executor seam forwards. Infrastructure owns this narrowing because the
 * application layer may not import `shared/auth`; being total means a new
 * authority code fails the build here instead of silently arriving at the UI as
 * a retryable `upstream_error`.
 */
const AUTHORITY_ADMISSION_CODES: Readonly<
  Record<GoogleContentAuthorityDenyCode, GoogleProviderAuthorityAdmissionCode>
> = {
  runtime_binding_mismatch: 'runtime_binding_mismatch',
  capability_killed: 'capability_killed',
  operator_not_registered: 'authorization_denied',
  reason_required: 'authorization_denied',
  authorization_denied: 'authorization_denied',
  authorization_changed: 'authorization_changed',
  operation_deadline_elapsed: 'operation_deadline_elapsed',
  permit_unavailable: 'permit_unavailable',
  permit_state_changed: 'permit_state_changed',
  start_deadline_elapsed: 'start_deadline_elapsed',
  state_not_admitted: 'state_not_admitted',
}

export function authorityAdmissionCode(
  code: GoogleContentAuthorityDenyCode,
): GoogleProviderAuthorityAdmissionCode {
  return AUTHORITY_ADMISSION_CODES[code]
}

export type GoogleProviderPermitAdmission = Readonly<{
  authorization: GoogleProviderCallAuthorization
  admission: GoogleProviderAdmissionMetadata
}>

/**
 * The app-side content authority denies with a closed, content-free code set.
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

const deadlineExceeded = (): ExecutionDenial => ({
  ok: false,
  code: 'deadline_exceeded',
  retryAfterMs: 0,
})

const denyAdmission = (admissionCode?: GoogleProviderAdmissionCode): ExecutionDenial => ({
  ok: false,
  code: 'admission_denied',
  ...(admissionCode === undefined ? {} : { admissionCode }),
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
        // Without this the only visible signal was a generic "rate limited"
        // in the UI: gateway-returned denials were never logged, so permit
        // and policy fences looked like provider quota pressure.
        deps.logger?.warn(
          {
            routeKey: descriptor.routeKey,
            stage: 'gateway',
            code: executed.code,
            ...(executed.admissionCode === undefined
              ? {}
              : { admissionCode: executed.admissionCode }),
            retryAfterMs: executed.retryAfterMs,
          },
          REJECTION_MESSAGE,
        )
      }
      return executed
    } catch {
      warnRejected(descriptor.routeKey, 'gateway', 'transport_error')
      return { ok: false, code: 'transport_error', retryAfterMs: 0 }
    }
  }

  return Object.freeze({
    execute: async (descriptor, options) => {
      if (options.signal?.aborted) return deadlineExceeded()

      const credentialAdmissionDenial = await credentialDenial(descriptor, options)
      if (credentialAdmissionDenial) return credentialAdmissionDenial

      const admission = compileAdmission(descriptor)
      if (!admission) return { ok: false, code: 'malformed_request', retryAfterMs: 0 }

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
