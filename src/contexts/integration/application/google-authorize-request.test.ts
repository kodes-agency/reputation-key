import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildGoogleAuthorizeUrl,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthCallbackUrl,
} from './google-authorize-request'

const ROOT = resolve(import.meta.dirname, '../../../..')

describe('Google authorize request', () => {
  // The Google client must list this exact address; a route moved without
  // the constant would send Google a callback nothing answers.
  it('names the callback route that actually exists', () => {
    expect(existsSync(resolve(ROOT, `src/routes${GOOGLE_OAUTH_CALLBACK_PATH}.ts`))).toBe(
      true,
    )
  })

  it('hangs the callback off the deployment base URL', () => {
    expect(googleOAuthCallbackUrl('https://beta.example')).toBe(
      'https://beta.example/api/auth/google/callback',
    )
  })

  it('asks for offline Business Profile access with PKCE and a nonce', () => {
    const url = new URL(
      buildGoogleAuthorizeUrl({
        clientId: 'client-1',
        callbackUrl: 'https://beta.example/api/auth/google/callback',
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://beta.example/api/auth/google/callback',
      scope: 'openid email https://www.googleapis.com/auth/business.manage',
      response_type: 'code',
      state: 'state-1',
      access_type: 'offline',
      prompt: 'consent',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    })
  })
})
