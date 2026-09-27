// Integration context — reconcile Google provider recovery.
//
// One bounded pass of both provider recovery stores, run by the worker's
// five-minute permit sweep: expire abandoned OAuth exchange attempts and
// settle elapsed disconnect-revoke attempts. It returns counts only; no
// tenant, connection, attempt, permit, credential binding or provider outcome
// leaves this function.

import type { GoogleDisconnectRevokeStore } from '../google-disconnect-revoke'
import type { GoogleOAuthExchangeRecoveryStore } from '../google-oauth-exchange-recovery'

export type ReconcileGoogleProviderRecoveryInput = Readonly<{
  now: Date
  limit: number
}>
export type ReconcileGoogleProviderRecoveryOutput = Readonly<{
  oauthExchangeAttemptsExpired: number
  disconnectAttemptsVisited: number
  disconnectConfirmedNotSent: number
  disconnectCleanupAmbiguous: number
}>
export type ReconcileGoogleProviderRecoveryDeps = Readonly<{
  exchangeRecovery: Pick<GoogleOAuthExchangeRecoveryStore, 'expire'>
  disconnectRevoke: Pick<GoogleDisconnectRevokeStore, 'reconcileElapsed'>
}>
export type ReconcileGoogleProviderRecovery = ReturnType<
  typeof reconcileGoogleProviderRecovery
>

export const reconcileGoogleProviderRecovery =
  (deps: ReconcileGoogleProviderRecoveryDeps) =>
  async ({
    now,
    limit,
  }: ReconcileGoogleProviderRecoveryInput): Promise<ReconcileGoogleProviderRecoveryOutput> => {
    const [oauth, revoke] = await Promise.all([
      deps.exchangeRecovery.expire({ now, limit }),
      deps.disconnectRevoke.reconcileElapsed({ now, limit }),
    ])
    return {
      oauthExchangeAttemptsExpired: oauth.expired,
      disconnectAttemptsVisited: revoke.visited,
      disconnectConfirmedNotSent: revoke.confirmedNotSent,
      disconnectCleanupAmbiguous: revoke.cleanupAmbiguous,
    }
  }
