import type { ConnectGoogleInput } from './dto/connect-google.dto'
import type { OAuthStateHandleService } from './oauth-state-handle'

export type RedeemedOAuthState = Extract<
  Awaited<ReturnType<OAuthStateHandleService['redeem']>>,
  { ok: true }
>

/**
 * Preserve the server-authoritative opaque ceremony facts through the callback.
 * The browser supplies only the authorization code and opaque state handle.
 */
export function buildOpaqueOAuthConnectInput(
  code: string,
  redeemed: RedeemedOAuthState,
): Extract<ConnectGoogleInput, { verifierMaterial: unknown }> {
  return {
    code,
    visibility: redeemed.visibility,
    purpose: redeemed.purpose,
    connectionMode: redeemed.connectionMode,
    targetConnectionId: redeemed.targetConnectionId,
    verifierMaterial: redeemed.verifierMaterial,
  }
}
