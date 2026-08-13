import type { GoogleOAuthPort } from './ports/google-oauth.port'
import type {
  CredentialLifecycleResult,
  CredentialLifecycleStore,
} from './credential-lifecycle'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

const TOKEN_AUDIENCE = 'credential-revoke-token-v1'

export type CredentialCleanupDispatchResult =
  | Readonly<{
      ok: true
      outcome: 'confirmed_not_sent' | 'confirmed_revoked' | 'cleanup_ambiguous'
    }>
  | Readonly<{
      ok: false
      code: 'lifecycle_denied' | 'lifecycle_unavailable'
    }>

export type CredentialCleanupAdmission = (
  input: Readonly<{
    organizationId: string
    revokePermitId: string
    tokenHmacKeyVersion: string
    tokenHmac: string
    now: Date
  }>,
) => Promise<Readonly<{ ok: true } | { ok: false; code: string }>>

function lifecycleAccepted<T>(
  result: CredentialLifecycleResult<T>,
): result is Readonly<{ ok: true; value: T }> {
  return result.ok
}

export function createCredentialCleanupDispatcher(
  deps: Readonly<{
    lifecycle: CredentialLifecycleStore
    tokenKeys: VersionedHmacKeyring
    admit: CredentialCleanupAdmission
    oauth: Pick<GoogleOAuthPort, 'revokeToken'>
    clock: () => Date
  }>,
): (
  input: Readonly<{
    organizationId: string
    revokePermitId: string
    token: string
  }>,
) => Promise<CredentialCleanupDispatchResult> {
  return async (input) => {
    const signed = deps.tokenKeys.sign(TOKEN_AUDIENCE, input.token)
    let admission: Awaited<ReturnType<CredentialCleanupAdmission>>
    try {
      admission = await deps.admit({
        organizationId: input.organizationId,
        revokePermitId: input.revokePermitId,
        tokenHmacKeyVersion: signed.keyVersion,
        tokenHmac: signed.digest,
        now: deps.clock(),
      })
    } catch {
      admission = { ok: false, code: 'admission_unavailable' }
    }

    if (!admission.ok) {
      try {
        const finished = await deps.lifecycle.finishCleanupWithoutDispatch({
          organizationId: input.organizationId,
          revokePermitId: input.revokePermitId,
          outcomeCode: admission.code,
          now: deps.clock(),
        })
        return lifecycleAccepted(finished)
          ? { ok: true, outcome: 'confirmed_not_sent' }
          : { ok: false, code: 'lifecycle_denied' }
      } catch {
        return { ok: false, code: 'lifecycle_unavailable' }
      }
    }

    let acquired: Awaited<ReturnType<CredentialLifecycleStore['acquireCleanupDispatch']>>
    try {
      acquired = await deps.lifecycle.acquireCleanupDispatch({
        organizationId: input.organizationId,
        revokePermitId: input.revokePermitId,
        tokenHmacKeyVersion: signed.keyVersion,
        tokenHmac: signed.digest,
        now: deps.clock(),
      })
    } catch {
      return { ok: false, code: 'lifecycle_unavailable' }
    }
    if (!lifecycleAccepted(acquired)) {
      return { ok: false, code: 'lifecycle_denied' }
    }

    let outcome: 'confirmed_revoked' | 'cleanup_ambiguous'
    let outcomeCode: string
    try {
      await deps.oauth.revokeToken(input.token)
      outcome = 'confirmed_revoked'
      outcomeCode = 'google_revoke_confirmed'
    } catch {
      outcome = 'cleanup_ambiguous'
      outcomeCode = 'google_revoke_outcome_ambiguous'
    }

    try {
      const finished = await deps.lifecycle.finishCleanup({
        organizationId: input.organizationId,
        revokePermitId: input.revokePermitId,
        outcome,
        outcomeCode,
        now: deps.clock(),
      })
      return lifecycleAccepted(finished)
        ? { ok: true, outcome }
        : { ok: false, code: 'lifecycle_denied' }
    } catch {
      return { ok: false, code: 'lifecycle_unavailable' }
    }
  }
}
