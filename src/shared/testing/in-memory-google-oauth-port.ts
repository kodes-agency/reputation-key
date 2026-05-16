// In-memory GoogleOAuthPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GoogleOAuthPort,
  GoogleOAuthResult,
} from '#/contexts/integration/application/ports/google-oauth.port'

// fallow-ignore-next-line unused-type
export type InMemoryGoogleOAuthPort = GoogleOAuthPort &
  Readonly<{
    setExchangeResult: (result: GoogleOAuthResult) => void
    setRefreshResult: (result: { accessToken: string; expiresIn: number }) => void
    setExchangeError: (error: Error) => void
    revokeTokenCalls: () => string[]
  }>

export const createInMemoryGoogleOAuthPort = (): InMemoryGoogleOAuthPort => {
  let exchangeResult: GoogleOAuthResult = {
    googleAccountId: 'google-account-123',
    googleEmail: 'test@gmail.com',
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
    scopes: ['https://www.googleapis.com/auth/business.manage'],
  }
  let refreshResult = { accessToken: 'refreshed-access-token', expiresIn: 3600 }
  let exchangeError: Error | null = null
  const revokedTokens: string[] = []

  return {
    exchangeCode: async (_code, _redirectUri) => {
      if (exchangeError) throw exchangeError
      return exchangeResult
    },
    refreshAccessToken: async (_refreshToken) => refreshResult,
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
  }
}
