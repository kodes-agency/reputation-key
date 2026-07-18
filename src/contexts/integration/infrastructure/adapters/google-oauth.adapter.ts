// Integration context — Google OAuth 2.0 adapter
// Per architecture: factory function returning GoogleOAuthPort.
// Handles code exchange, token refresh, user info fetch, and URL building.

import { z } from 'zod'
import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import { integrationError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

const googleTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})
const googleUserInfoSchema = z.object({
  id: z.string(),
  email: z.string(),
  verified_email: z.boolean().optional(),
  name: z.string().optional(),
})
const googleTokenRefreshSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

// BQC-4.3: endpoint URLs arrive via construction config from the composition
// root's providerConfigFor mapping — no hardcoded or fallback endpoints
// (ADR 0031/0048).
export const createGoogleOAuthAdapter = (config: {
  clientId: string
  clientSecret: string
  tokenUrl: string
  userInfoUrl: string
  revokeUrl: string
}): GoogleOAuthPort => {
  const clientId = config.clientId
  const clientSecret = config.clientSecret
  const tokenUrl = config.tokenUrl
  const userInfoUrl = config.userInfoUrl
  const revokeUrl = config.revokeUrl

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
    const response = await trace('googleOAuth.exchangeCode', () =>
      fetch(tokenUrl, {
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
      }),
    )

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read response body')
      throw integrationError(
        'oauth_failed',
        `Failed to exchange authorization code with Google: ${response.status} ${errorBody}`,
      )
    }

    const data = googleTokenResponseSchema.parse(await response.json())
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
    const userInfoResponse = await trace('googleOAuth.fetchUserInfo', () =>
      fetch(userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    )

    if (!userInfoResponse.ok) {
      const errorBody = await userInfoResponse
        .text()
        .catch(() => 'unable to read response body')
      throw integrationError(
        'oauth_failed',
        `Failed to fetch Google account information: ${userInfoResponse.status} ${errorBody}`,
      )
    }

    const userInfo = googleUserInfoSchema.parse(await userInfoResponse.json())

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
    const response = await trace('googleOAuth.refreshToken', () =>
      fetch(tokenUrl, {
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
      }),
    )

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read response body')
      throw integrationError(
        'token_refresh_failed',
        `Failed to refresh Google access token: ${response.status} ${errorBody}`,
      )
    }

    const data = googleTokenRefreshSchema.parse(await response.json())
    const accessToken = data.access_token
    const expiresIn = data.expires_in

    return {
      accessToken,
      expiresIn,
    }
  }

  const revokeToken = async (token: string): Promise<void> => {
    const response = await trace('googleOAuth.revokeToken', () =>
      fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token,
        }),
      }),
    )

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
