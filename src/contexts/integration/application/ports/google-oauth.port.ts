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
  exchangeCode: (code: string, redirectUri: string) => Promise<GoogleOAuthResult>
  refreshAccessToken: (
    refreshToken: string,
  ) => Promise<{ accessToken: string; expiresIn: number }>
  revokeToken: (token: string) => Promise<void>
}>
