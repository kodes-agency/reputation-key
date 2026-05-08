// Integration context — Google OAuth 2.0 adapter
// Per architecture: factory function returning GoogleOAuthPort.
// Handles code exchange, token refresh, user info fetch, and URL building.

import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import { getEnv } from '#/shared/config/env'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const createGoogleOAuthAdapter = (): GoogleOAuthPort => {
  const clientId = getEnv().GOOGLE_CLIENT_ID
  const clientSecret = getEnv().GOOGLE_CLIENT_SECRET

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
      await response.text().catch(() => '')
      throw new Error('Failed to exchange authorization code with Google')
    }

    const data = await response.json()
    const accessToken = data.access_token
    const refreshToken = data.refresh_token
    const expiresIn = data.expires_in
    const scopes = (data.scope as string).split(' ')

    if (!refreshToken) {
      throw new Error(
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
      await userInfoResponse.text().catch(() => '')
      throw new Error('Failed to fetch Google account information')
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
      await response.text().catch(() => '')
      throw new Error('Failed to refresh Google access token')
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
      await response.text().catch(() => '')
      throw new Error('Failed to revoke Google token')
    }
  }

  return {
    exchangeCode,
    refreshAccessToken,
    revokeToken,
  }
}
