import type { GoogleExecutionPermitIssuerStore } from '#/shared/auth/google-execution-permit-issuer'
import type { Database } from '#/shared/db'
import type { GoogleContentAuthorizationCheck } from '#/shared/domain/google-content-authorization-vector'

type AuthorizationStore = Pick<
  GoogleExecutionPermitIssuerStore<Database>,
  'transaction' | 'loadControl'
>
type AuthorizationInput = Parameters<GoogleContentAuthorizationCheck<Database>>[1]

/** Reads the live kill switch, then runs the authorization check, in one transaction. */
export function checkLiveGoogleAuthorization(
  store: AuthorizationStore,
  authorize: GoogleContentAuthorizationCheck<Database>,
  input: AuthorizationInput,
) {
  return store.transaction(async (tx) => {
    const control = await store.loadControl(tx)
    if (control.killedCapabilities.includes(input.capability)) {
      return { ok: false as const, code: 'capability_killed' as const }
    }
    const decision = await authorize(tx, input)
    return decision.allowed
      ? { ok: true as const, authorizationVector: decision.vector }
      : { ok: false as const, code: 'authorization_denied' as const }
  })
}

/** Checks live controls and scope before a provider authorization is returned. */
export function createGoogleContentAuthorizer(
  deps: Readonly<{
    store: AuthorizationStore
    authorize: GoogleContentAuthorizationCheck<Database>
    warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
) {
  return async (
    surface: 'import' | 'performance' | 'review-sync' | 'reply-publication',
    input: AuthorizationInput,
  ) => {
    const result = await checkLiveGoogleAuthorization(deps.store, deps.authorize, input)
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
