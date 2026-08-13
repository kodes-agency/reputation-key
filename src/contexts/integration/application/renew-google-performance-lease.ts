import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { GooglePerformanceAuthorizer } from './get-property-google-performance'

export type RenewGooglePerformanceLease = (
  input: Readonly<{
    propertyId: PropertyId
    leaseRef: string
    actor: AuthContext
  }>,
) => Promise<
  Readonly<{ ok: true; lease: ProviderContentLeaseDto }> | Readonly<{ ok: false }>
>

export function createRenewGooglePerformanceLease(
  deps: Readonly<{
    authorize: GooglePerformanceAuthorizer
    renew: ProviderAuthorizationLeaseService['renew']
    clock: () => Date
  }>,
): RenewGooglePerformanceLease {
  return async (input) => {
    try {
      const authorization = await deps.authorize({
        actor: input.actor,
        propertyId: input.propertyId,
        phase: 'before_return',
      })
      if (!authorization.ok) return { ok: false }
      const renewed = await deps.renew({
        leaseRef: input.leaseRef,
        principalHmacKeyVersion: authorization.snapshot.principalHmacKeyVersion,
        principalHmac: authorization.snapshot.principalHmac,
        approvalBindingId: authorization.snapshot.approvalBindingId,
        authorizationVectorSha256: authorization.snapshot.authorizationVectorSha256,
        nowMs: deps.clock().getTime(),
      })
      return renewed.ok
        ? Object.freeze({ ok: true as const, lease: renewed.lease })
        : Object.freeze({ ok: false as const })
    } catch {
      return Object.freeze({ ok: false as const })
    }
  }
}
