// Integration context — Google OAuth 2.0 adapter
// Per architecture: factory function returning GoogleOAuthPort.
// Handles code exchange, token refresh, user info fetch, and URL building.

import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import { integrationError } from '../../domain/errors'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const createGoogleOAuthAdapter = (config: { clientId: string; clientSecret: string }): GoogleOAuthPort => {
  const clientId = config.clientId
  const clientSecret = config.clientSecret

  const exchangeCode = async (
    code: string,
    redirectUriParam: string,
  ): Promise<{
    googleAccountId: string
    googleEmail: string
    accessToken: string
    refreshToken: string
    expiresIn: number
    scopes: readonly string[]
  }> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUriParam,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read response body')
      throw integrationError(
        'oauth_failed',
        `Failed to exchange authorization code with Google: ${response.status} ${errorBody}`,
      )
    }

    const data = await response.json()
    const accessToken = data.access_token
    const refreshToken = data.refresh_token
    const expiresIn = data.expires_in
    const scopes =
      typeof data.scope === 'string' && data.scope.length > 0 ? data.scope.split(' ') : []

    if (!refreshToken) {
      throw integrationError(
        'oauth_failed',
        'Google OAuth did not return a refresh token. Ensure prompt=consent is set.',
      )
    }

    // Fetch user info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!userInfoResponse.ok) {
      const errorBody = await userInfoResponse
        .text()
        .catch(() => 'unable to read response body')
      throw integrationError(
        'oauth_failed',
        `Failed to fetch Google account information: ${userInfoResponse.status} ${errorBody}`,
      )
    }

    const userInfo = await userInfoResponse.json()

    return {
      accessToken,
      refreshToken,
      expiresIn,
      googleAccountId: userInfo.id,
      googleEmail: userInfo.email,
      scopes: Object.freeze(scopes),
    }
  }

  const refreshAccessToken = async (
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read response body')
      throw integrationError(
        'token_refresh_failed',
        `Failed to refresh Google access token: ${response.status} ${errorBody}`,
      )
    }

    const data = await response.json()
    const accessToken = data.access_token
    const expiresIn = data.expires_in

    return {
      accessToken,
      expiresIn,
    }
  }

  const revokeToken = async (token: string): Promise<void> => {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read response body')
      throw integrationError(
        'oauth_failed',
        `Failed to revoke Google token: ${response.status} ${errorBody}`,
      )
    }
  }

  return {
    exchangeCode,
    refreshAccessToken,
    revokeToken,
  }
}
