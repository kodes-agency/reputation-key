import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type { GoogleProviderCallAuthorization } from '../google-provider-contract'

export type GoogleProviderExecutionResult =
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
