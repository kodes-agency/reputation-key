import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import type {
  ProviderAuthorizationLeaseRejection,
  ProviderAuthorizationLeaseService,
} from '#/shared/provider-ephemeral/authorization-lease'
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

/**
 * Refusals that mean the lease runtime itself is broken: its store or
 * readiness failed, or a stored record or handle could not be read. Every
 * other refusal (expired, not found, changed or denied authorization, a
 * concurrent renewal) is the ten-second poll doing its job.
 */
const LEASE_RUNTIME_FAULTS: ReadonlySet<ProviderAuthorizationLeaseRejection> = new Set([
  'runtime_unavailable',
  'malformed',
])

export function createRenewGooglePerformanceLease(
  deps: Readonly<{
    authorize: GooglePerformanceAuthorizer
    renew: ProviderAuthorizationLeaseService['renew']
    clock: () => Date
    /**
     * Optional so existing constructions and tests keep working. When absent
     * this module behaves exactly as before — it just says nothing.
     */
    logger?: Pick<LoggerPort, 'warn'>
  }>,
): RenewGooglePerformanceLease {
  // The browser only ever learns `{ ok: false }` and clears the panel (ADR
  // 0050), which is right for the user and silent for the operator; the
  // authorizer recorded the same blind spot on 2026-09-01. Content-free
  // fields only: never the lease handle, the principal digest or provider
  // content.
  const failClosed = (detail: Readonly<Record<string, unknown>>) => {
    deps.logger?.warn(
      { surface: 'google-performance', stage: 'renew_lease', ...detail },
      'Google performance lease renewal failed',
    )
    return Object.freeze({ ok: false as const })
  }

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
        authorizationFenceSha256: authorization.snapshot.authorizationFenceSha256,
        nowMs: deps.clock().getTime(),
      })
      if (renewed.ok) return Object.freeze({ ok: true as const, lease: renewed.lease })
      return LEASE_RUNTIME_FAULTS.has(renewed.code)
        ? failClosed({ code: renewed.code })
        : Object.freeze({ ok: false as const })
    } catch (error) {
      return failClosed(
        error instanceof Error
          ? { err: { name: error.name, message: error.message } }
          : {},
      )
    }
  }
}
