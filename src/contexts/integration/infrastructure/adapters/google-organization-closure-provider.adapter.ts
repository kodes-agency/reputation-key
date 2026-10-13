// LIF-01-T12 — the concrete provider seam Organization closing revokes through.
//
// This is a thin, deliberately dumb binding of the pieces the reviewed
// disconnect seam already uses (`disconnect-google-account.ts`): the GBP
// notifications unsubscribe, the token decryptor, and the OAuth revoke. It
// exists so the lifecycle adapter can be driven by a recorded fixture in tests
// and by the real provider in production WITHOUT the two paths differing in
// anything except this file.
//
// The one rule it adds over the disconnect seam is total: it never throws. A
// closure that aborted on a provider error would roll back the local fence and
// leave the Organization both un-revoked and un-fenced.

import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type {
  GoogleClosureConnectionTarget,
  GoogleClosureRevocationOutcome,
  GoogleClosureSubscriptionOutcome,
  GoogleOrganizationClosureProviderPort,
} from '../../application/ports/google-organization-closure.port'
import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import type {
  GbpUnsubscribeOutcome,
  GbpUnsubscribeResult,
} from '../../application/use-cases/manage-notifications'

/**
 * The sentinel the disconnect command store writes over redacted credential
 * columns. A redacted row holds no grant, so sending it to Google would be a
 * meaningless request with a real failure mode.
 */
const REDACTED_CREDENTIAL = 'redacted'

/**
 * What closing may record for each answer of the unsubscribe. `stopped` is what
 * the closing evidence counts, and the refresh token is redacted in the same
 * transaction, so it is claimed only when every bound account was cleared. A
 * refusal, and a connection with no account to target, sent nothing. A provider
 * failure may have cleared some accounts and not others, or reached Google
 * without an answer we could confirm: it cannot be proved either way.
 */
const SUBSCRIPTION_OUTCOME: Readonly<
  Record<GbpUnsubscribeOutcome, GoogleClosureSubscriptionOutcome>
> = Object.freeze({
  unsubscribed: 'stopped',
  connection_missing: 'not_sent',
  connection_inactive: 'not_sent',
  token_unavailable: 'not_sent',
  authorization_unavailable: 'not_sent',
  account_unresolved: 'not_sent',
  provider_failed: 'ambiguous',
})

export type GoogleOrganizationClosureProviderDeps = Readonly<{
  oauth: Pick<GoogleOAuthPort, 'revokeToken' | 'revokeTokenWithOutcome'>
  encryption: Pick<TokenEncryptionPort, 'decrypt'>
  unsubscribeFromNotifications: (
    organization: OrganizationId,
    connection: GoogleConnectionId,
  ) => Promise<GbpUnsubscribeResult>
}>

export const createGoogleOrganizationClosureProvider = (
  deps: GoogleOrganizationClosureProviderDeps,
): GoogleOrganizationClosureProviderPort =>
  Object.freeze({
    async stopNotificationSubscriptions(
      target: GoogleClosureConnectionTarget,
    ): Promise<GoogleClosureSubscriptionOutcome> {
      if (target.encryptedRefreshToken === REDACTED_CREDENTIAL) {
        // No credential means no subscription can still be ours to stop.
        return 'already_stopped'
      }
      try {
        const { outcome } = await deps.unsubscribeFromNotifications(
          organizationId(target.organizationId),
          googleConnectionId(target.connectionId),
        )
        return SUBSCRIPTION_OUTCOME[outcome]
      } catch {
        // `manageNotifications.unsubscribe` reports refusals and provider
        // failures as outcomes and does not throw; anything reaching here is a
        // defect we cannot prove either way.
        return 'ambiguous'
      }
    },

    async revokeCredentials(
      target: GoogleClosureConnectionTarget,
    ): Promise<GoogleClosureRevocationOutcome> {
      if (target.encryptedRefreshToken === REDACTED_CREDENTIAL) {
        // Convergence, not failure: a previous pass already revoked and
        // redacted this grant.
        return 'already_revoked'
      }
      let refreshToken: string
      try {
        refreshToken = deps.encryption.decrypt(target.encryptedRefreshToken)
      } catch {
        // An undecryptable stored token cannot be sent, and we hold no other
        // copy of it. Nothing was dispatched.
        return 'confirmed_not_sent'
      }
      try {
        if (deps.oauth.revokeTokenWithOutcome) {
          return await deps.oauth.revokeTokenWithOutcome(refreshToken)
        }
        await deps.oauth.revokeToken(refreshToken)
        return 'confirmed_revoked'
      } catch {
        return 'cleanup_ambiguous'
      }
    },
  })
