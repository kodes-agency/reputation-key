// In-memory GoogleOAuthPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GoogleOAuthPort,
  GoogleOAuthResult,
} from '#/contexts/integration/application/ports/google-oauth.port'

export type InMemoryGoogleOAuthPort = GoogleOAuthPort &
  Readonly<{
    setExchangeResult: (result: GoogleOAuthResult) => void
    setRefreshResult: (result: { accessToken: string; expiresIn: number }) => void
    setExchangeError: (error: Error) => void
    revokeTokenCalls: () => string[]
    refreshAccessTokenCalls: () => string[]
    /** The PKCE verifiers received by exchangeCode, in call order (BQC-7.6). */
    exchangeVerifierCalls: () => ReadonlyArray<string>
  }>

export const createInMemoryGoogleOAuthPort = (): InMemoryGoogleOAuthPort => {
  let exchangeResult: GoogleOAuthResult = {
    identity: { kind: 'oidc', googleSubject: 'google-subject-123' },
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
    scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
  }
  let refreshResult = { accessToken: 'refreshed-access-token', expiresIn: 3600 }
  let exchangeError: Error | null = null
  const revokedTokens: string[] = []
  const exchangeVerifiers: string[] = []
  const refreshedTokens: string[] = []

  return {
    exchangeCode: async (input) => {
      exchangeVerifiers.push(input.codeVerifier)
      if (exchangeError) throw exchangeError
      return exchangeResult
    },
    refreshAccessToken: async (refreshToken) => {
      refreshedTokens.push(refreshToken)
      return refreshResult
    },
    revokeToken: async (token) => {
      revokedTokens.push(token)
    },
    setExchangeResult: (result) => {
      exchangeResult = result
    },
    setRefreshResult: (result) => {
      refreshResult = result
    },
    setExchangeError: (error) => {
      exchangeError = error
    },
    revokeTokenCalls: () => [...revokedTokens],
    refreshAccessTokenCalls: () => [...refreshedTokens],
    exchangeVerifierCalls: () => [...exchangeVerifiers],
  }
}
