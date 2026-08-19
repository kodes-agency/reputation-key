import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
  type GoogleProviderRouteTarget,
} from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderAdmissionCode,
  GoogleProviderAuthorityAdmissionCode,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleContentAuthorityDenyCode } from '#/shared/auth/google-content-authority'

/**
 * Total map from the content authority's own deny union onto the closed set the
 * executor seam forwards. Infrastructure owns this narrowing because the
 * application layer may not import `shared/auth`; being total means a new
 * authority code fails the build here instead of silently arriving at the UI as
 * a retryable `upstream_error`. Every approval-validation code collapses to
 * `approval_invalid` — the specific reason is operator-facing, not user-facing.
 */
const AUTHORITY_ADMISSION_CODES: Readonly<
  Record<GoogleContentAuthorityDenyCode, GoogleProviderAuthorityAdmissionCode>
> = {
  binding_not_approved: 'approval_invalid',
  binding_expired: 'approval_invalid',
  invalid_phase_profile: 'approval_invalid',
  invalid_approval_window: 'approval_invalid',
  invalid_railway_cohort: 'approval_invalid',
  railway_cohort_digest_mismatch: 'approval_invalid',
  railway_residual_binding_mismatch: 'approval_invalid',
  railway_residual_risk_denied: 'approval_invalid',
  railway_approval_owner_mismatch: 'approval_invalid',
  index_digest_mismatch: 'approval_invalid',
  manifest_digest_mismatch: 'approval_invalid',
  deployment_artifact_mismatch: 'approval_invalid',
  missing_role_approval: 'approval_invalid',
  duplicate_role_approval: 'approval_invalid',
  role_digest_mismatch: 'approval_invalid',
  role_manifest_mismatch: 'approval_invalid',
  role_binding_mismatch: 'approval_invalid',
  role_window_mismatch: 'approval_invalid',
  content_treatment_denied: 'approval_invalid',
  invalid_role_signature: 'approval_invalid',
  approval_unavailable: 'approval_unavailable',
  runtime_binding_mismatch: 'runtime_binding_mismatch',
  capability_killed: 'capability_killed',
  policy_refresh_unavailable: 'policy_refresh_unavailable',
  operator_not_registered: 'authorization_denied',
  reason_required: 'authorization_denied',
  authorization_denied: 'authorization_denied',
  authorization_changed: 'authorization_changed',
  operation_deadline_elapsed: 'operation_deadline_elapsed',
  permit_unavailable: 'permit_unavailable',
  permit_state_changed: 'permit_state_changed',
  start_deadline_elapsed: 'start_deadline_elapsed',
  policy_version_changed: 'policy_version_changed',
  emergency_kill_changed: 'emergency_kill_changed',
  state_not_admitted: 'state_not_admitted',
  approval_binding_changed: 'approval_binding_changed',
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
 * Collapsing it to a bare string erased the difference between a real
 * authorization/approval change and a transient outage, so the UI offered a
 * pointless retry; the executor forwards the exact code instead.
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

export function createGoogleAuthorizedProviderExecutor(
  deps: Readonly<{
    bindCredential: (credential: string) => string
    admit: GoogleProviderPermitAdmitter
    gateway: GoogleEgressGatewayClient
    routeTarget?: GoogleProviderRouteTarget
    logger?: Readonly<{
      warn(fields: Readonly<Record<string, unknown>>, message: string): void
    }>
  }>,
): GoogleAuthorizedProviderExecutor {
  return Object.freeze({
    execute: async (descriptor, options) => {
      if (options.signal?.aborted) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      let admission: GoogleProviderAdmissionMetadata
      try {
        admission = compileGoogleProviderRequest(
          descriptor,
          deps.bindCredential,
          deps.routeTarget,
        ).admission
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'compile', code: 'malformed_request' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'malformed_request', retryAfterMs: 0 }
      }
      let permit: Awaited<ReturnType<GoogleProviderPermitAdmitter>>
      try {
        permit = await deps.admit({ authorization: options.authorization, admission })
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'admit', code: 'admission_error' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'admission_denied', retryAfterMs: 0 }
      }
      if (!permit.ok) {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'admit', code: permit.code },
          'Google provider execution rejected',
        )
        return {
          ok: false,
          code: 'admission_denied',
          admissionCode: permit.code,
          retryAfterMs: 0,
        }
      }
      if (options.signal?.aborted) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      try {
        const executed = await deps.gateway.execute({
          permitId: permit.permitId,
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
            'Google provider execution rejected',
          )
        }
        return executed
      } catch {
        deps.logger?.warn(
          { routeKey: descriptor.routeKey, stage: 'gateway', code: 'transport_error' },
          'Google provider execution rejected',
        )
        return { ok: false, code: 'transport_error', retryAfterMs: 0 }
      }
    },
  })
}
