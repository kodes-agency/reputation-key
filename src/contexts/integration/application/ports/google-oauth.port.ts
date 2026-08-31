// Integration context — Google OAuth port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// OAuth boundary for Google authentication flows.

import type { GoogleProviderCallAuthorization } from '../google-provider-contract'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'

export type GoogleOAuthIdentity = Readonly<{
  kind: 'oidc'
  googleSubject: string
}>

export type GoogleOAuthResult = Readonly<{
  identity: GoogleOAuthIdentity
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: ReadonlyArray<string>
}>

/**
 * The smallest complete token response that can be encrypted before OIDC/JWKS
 * validation. It is never a DTO and must not leave the server process.
 */
export type GoogleOAuthPreservedExchangeResult = Readonly<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: ReadonlyArray<string>
  idToken: string
}>

export type GoogleOAuthExchangeInput = Readonly<{
  contractVersion: 'v2'
  code: string
  redirectUri: string
  codeVerifier: string
  oidcNonce: string
  /** Required by the governed production executor; direct test adapters ignore it. */
  authorization?: GoogleProviderCallAuthorization
  /**
   * Recovery path: validate an already encrypted-and-reloaded response without
   * sending the one-use authorization code again.
   */
  preservedResult?: GoogleOAuthPreservedExchangeResult
  /** Called before JWKS, identity validation, uniqueness checks, or audit commit. */
  preserveSuccessfulResult?: (result: GoogleOAuthPreservedExchangeResult) => Promise<void>
}>

export type GoogleOAuthPort = Readonly<{
  /**
   * Exchange an authorization code for tokens. `codeVerifier` is the PKCE
   * (RFC 7636) verifier whose challenge was sent on the authorization URL —
   * required since BQC-7.6 (the flow always issues a challenge).
   */
  exchangeCode: (input: GoogleOAuthExchangeInput) => Promise<GoogleOAuthResult>
  refreshAccessToken: (
    refreshToken: string,
    authorization?: GoogleProviderCallAuthorization,
  ) => Promise<{ accessToken: string; expiresIn: number }>
  revokeToken: (
    token: string,
    authorization?: GoogleProviderCallAuthorization,
  ) => Promise<void>
  revokeTokenWithOutcome?: (
    token: string,
    authorization?: GoogleProviderCallAuthorization,
  ) => Promise<'confirmed_not_sent' | 'confirmed_revoked' | 'cleanup_ambiguous'>
}>

export type GoogleOAuthProviderCallAuthorizer = (
  input: Readonly<{
    operation: 'oauth.token.exchange' | 'oauth.token.refresh' | 'oauth.revoke'
    organizationId: OrganizationId
    connectionId: GoogleConnectionId
    initiatorUserId: UserId
    disconnectRevoke?: Readonly<{
      attemptId: string
      cleanupDeadlineAt: Date
    }>
  }>,
) => Promise<GoogleProviderCallAuthorization>
