// Integration context — Google OAuth 2.0 adapter
// Per architecture: factory function returning GoogleOAuthPort.
// Handles code exchange, token refresh, user info fetch, and URL building.

import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import { getEnv } from '#/shared/config/env'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const createGoogleOAuthAdapter = (_redirectUri: string): GoogleOAuthPort => {
  const clientId = getEnv().GOOGLE_CLIENT_ID
  const clientSecret = getEnv().GOOGLE_CLIENT_SECRET

  const getAuthorizationUrl = (redirectUriParam: string, state: string): string => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUriParam,
      scope: 'https://www.googleapis.com/auth/business.manage',
      response_type: 'code',
      state,
      access_type: 'offline',
      prompt: 'consent', // Force consent to get refresh token
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

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
      const errorText = await response.text()
      throw new Error(
        `Google OAuth token exchange failed: ${response.status} ${errorText}`,
      )
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
      throw new Error(`Google OAuth user info fetch failed: ${userInfoResponse.status}`)
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
      const errorText = await response.text()
      throw new Error(
        `Google OAuth token refresh failed: ${response.status} ${errorText}`,
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
      throw new Error(`Google OAuth token revoke failed: ${response.status}`)
    }
  }

  return {
    getAuthorizationUrl,
    exchangeCode,
    refreshAccessToken,
    revokeToken,
  }
}
