import type { GoogleExecutionPermitIssuerStore } from '#/shared/auth/google-execution-permit-issuer'
import type { Database } from '#/shared/db'
import type { GoogleContentAuthorizationCheck } from '#/shared/domain/google-content-authorization-vector'

/** Checks live controls and scope before a provider authorization is returned. */
export function createGoogleContentAuthorizer(
  deps: Readonly<{
    store: Pick<GoogleExecutionPermitIssuerStore<Database>, 'transaction' | 'loadControl'>
    authorize: GoogleContentAuthorizationCheck<Database>
    warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
) {
  return async (
    surface: 'import' | 'performance' | 'review-sync' | 'reply-publication',
    input: Parameters<GoogleContentAuthorizationCheck<Database>>[1],
  ) => {
    const result = await deps.store.transaction(async (tx) => {
      const control = await deps.store.loadControl(tx)
      if (control.killedCapabilities.includes(input.capability)) {
        return { ok: false as const, code: 'capability_killed' }
      }
      const decision = await deps.authorize(tx, input)
      return decision.allowed
        ? { ok: true as const, authorizationVector: decision.vector }
        : { ok: false as const, code: 'authorization_denied' }
    })
    if (result.ok) return result
    deps.warn(
      { stage: 'google-content-authorize', surface, code: result.code },
      'Google Content authorization denied',
    )
    return {
      ok: false as const,
      code:
        result.code === 'authorization_denied'
          ? ('authorization_denied' as const)
          : ('runtime_unavailable' as const),
    }
  }
}
