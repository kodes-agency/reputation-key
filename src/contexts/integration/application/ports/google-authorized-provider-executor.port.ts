import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderCallAuthorization } from '../google-provider-contract'

/**
 * Content-free denial reasons the internal egress gateway can report for
 * `admission_denied`. Only `quota_exhausted` / `in_flight_exhausted` mean
 * provider quota pressure; the rest are permit or policy fences.
 */
export type GoogleProviderGatewayAdmissionCode =
  | 'malformed_request'
  | 'permit_unknown'
  | 'permit_expired'
  | 'gateway_mismatch'
  | 'route_mismatch'
  | 'request_mismatch'
  | 'coordination_unavailable'
  | 'quota_exhausted'
  | 'in_flight_exhausted'
  | 'authorization_changed'
  | 'grant_unavailable'

/**
 * The app-side content authority's denial reasons that this seam forwards.
 * Declared here rather than imported: `shared/auth` is outside the application
 * layer's dependency zone. The adapter maps the authority's own closed union
 * onto this set exhaustively, so adding an authority code without deciding how
 * it surfaces is a type error rather than a silent `upstream_error`.
 */
export type GoogleProviderAuthorityAdmissionCode =
  | 'approval_unavailable'
  | 'approval_binding_changed'
  | 'runtime_binding_mismatch'
  | 'capability_killed'
  | 'policy_refresh_unavailable'
  | 'authorization_denied'
  | 'authorization_changed'
  | 'operation_deadline_elapsed'
  | 'permit_unavailable'
  | 'permit_state_changed'
  | 'start_deadline_elapsed'
  | 'policy_version_changed'
  | 'emergency_kill_changed'
  | 'state_not_admitted'
  | 'approval_invalid'

/**
 * Every content-free admission denial reason, from either admission side: the
 * gateway's own permit checks above, or the app-side content authority, whose
 * closed deny codes distinguish a real authorization/approval change from a
 * transient outage. Codes only — never a provider identifier or payload.
 */
export type GoogleProviderAdmissionCode =
  | GoogleProviderGatewayAdmissionCode
  | GoogleProviderAuthorityAdmissionCode
  | 'wrong_cell'
  | 'cell_unavailable'
  | 'credential_home_unavailable'
  | 'credential_home_mismatch'
  | 'runtime_unavailable'

export type GoogleProviderExecutionResult =
  | Readonly<{
      ok: true
      status: number
      headers: Readonly<{
        contentType: string | null
        cacheControl: string | null
        retryAfter: string | null
        /** Provider request identifier when the gateway exposes one. */
        providerCorrelationId?: string | null
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
      /** Content-free execution-admission denial reason for `admission_denied`. */
      admissionCode?: GoogleProviderAdmissionCode
      retryAfterMs: number
    }>

/**
 * Operation-scoped provider execution seam. Its implementation admits an exact
 * one-use permit and sends the descriptor only through the internal mTLS
 * gateway. Adapters never construct provider URLs or choose quota policy.
 */
export type GoogleAuthorizedProviderExecutor = Readonly<{
  execute(
    descriptor: GoogleProviderRouteDescriptor,
    options: Readonly<{
      authorization: GoogleProviderCallAuthorization
      deadlineMs: number
      signal?: AbortSignal
    }>,
  ): Promise<GoogleProviderExecutionResult>
}>
