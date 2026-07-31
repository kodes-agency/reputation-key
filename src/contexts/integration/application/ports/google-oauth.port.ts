// Integration context — Google OAuth port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// OAuth boundary for Google authentication flows.

export type GoogleOAuthResult = Readonly<{
  googleAccountId: string
  googleEmail: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: ReadonlyArray<string>
}>

export type GoogleOAuthPort = Readonly<{
  /**
   * Exchange an authorization code for tokens. `codeVerifier` is the PKCE
   * (RFC 7636) verifier whose challenge was sent on the authorization URL —
   * required since BQC-7.6 (the flow always issues a challenge).
   */
  exchangeCode: (
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ) => Promise<GoogleOAuthResult>
  refreshAccessToken: (
    refreshToken: string,
  ) => Promise<{ accessToken: string; expiresIn: number }>
  revokeToken: (token: string) => Promise<void>
}>
