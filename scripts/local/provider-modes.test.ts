import { describe, expect, it } from 'vitest'
import {
  applyProviderEndpointOverrides,
  GOOGLE_PROVIDER_ENDPOINTS,
} from '../../src/composition'
import type { Env } from '../../src/shared/config/env'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '../../src/shared/ai-operation-profiles'
import {
  aiProviderMode,
  applyEnvOverlay,
  googleProviderMode,
  parseEnvOverlay,
} from './provider-modes'

/** What `e2e/stack.env` pins, i.e. the state the real mode has to undo. */
function sandboxEnv(): NodeJS.ProcessEnv {
  // A plain mutable record: the runner reads and deletes `process.env` keys.
  return {
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
    GBP_ACCOUNT_MANAGEMENT_BASE_URL: 'https://provider-sandbox:4100/v1',
    GBP_API_BASE_URL: 'https://provider-sandbox:4100',
    GBP_PERFORMANCE_BASE_URL: 'http://provider-sandbox:4100',
    GBP_REVIEWS_API_BASE_URL: 'http://provider-sandbox:4100',
    GBP_NOTIFICATIONS_API_BASE_URL: 'http://provider-sandbox:4100',
    GOOGLE_OAUTH_TOKEN_URL: 'http://provider-sandbox:4100/oauth/token',
    GOOGLE_OAUTH_REVOKE_URL: 'http://provider-sandbox:4100/oauth/revoke',
    GOOGLE_OAUTH_JWKS_URL: 'http://provider-sandbox:4100/oauth/jwks',
  }
}

const REAL_CREDENTIALS = {
  GOOGLE_CLIENT_ID:
    '223390342009-aeun3f30npipfaq6kl21fbfsdn769aav.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-not-a-real-secret',
} as const

describe('local.env overlay', () => {
  it('sets values, unsets on an empty value, and ignores comments', () => {
    const overlay = parseEnvOverlay(
      [
        '# comment',
        'REPKEY_LOCAL_GOOGLE=real',
        'GBP_API_BASE_URL=',
        'QUOTED="a b"',
        'TRAILING=x # why',
        '',
        'no-equals',
      ].join('\n'),
    )
    expect([...overlay]).toEqual([
      ['REPKEY_LOCAL_GOOGLE', 'real'],
      ['GBP_API_BASE_URL', undefined],
      ['QUOTED', 'a b'],
      ['TRAILING', 'x'],
    ])
  })

  it('leaves the environment alone when no overlay file exists', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'me' }
    expect(applyEnvOverlay(env, '/nonexistent/local.env')).toEqual([])
    expect(env).toEqual({ KEEP: 'me' })
  })
})

describe('local Google provider mode', () => {
  it('keeps the sandbox by default', () => {
    const env = sandboxEnv()
    const mode = googleProviderMode(env)
    expect(mode.kind).toBe('sandbox')
    expect(env.GOOGLE_PROVIDER_ENDPOINT_PROFILE).toBe('local-sandbox')
    expect(env.GBP_API_BASE_URL).toBe('https://provider-sandbox:4100')
  })

  it('resolves every approved Google endpoint in real mode', () => {
    const env: NodeJS.ProcessEnv = {
      ...sandboxEnv(),
      ...REAL_CREDENTIALS,
      REPKEY_LOCAL_GOOGLE: 'real',
    }
    const mode = googleProviderMode(env)

    expect(mode.kind).toBe('real')
    expect(env.GOOGLE_PROVIDER_ENDPOINT_PROFILE).toBe('production-fixed')
    // The app's own override seam is the judge: a pin this module forgets to
    // remove would still retarget its endpoint, and the stack would claim LIVE
    // while talking to the sandbox.
    expect(
      applyProviderEndpointOverrides(GOOGLE_PROVIDER_ENDPOINTS, env as unknown as Env),
    ).toEqual(GOOGLE_PROVIDER_ENDPOINTS)
  })

  it('names the redirect URI to register instead of starting a doomed stack', () => {
    for (const credentials of [
      {},
      { GOOGLE_CLIENT_ID: 'local-bd8b6708c60b9d2cbb21b9d1c524cec9' },
      { ...REAL_CREDENTIALS, GOOGLE_CLIENT_SECRET: 'local-secret' },
    ]) {
      expect(() =>
        googleProviderMode({
          ...sandboxEnv(),
          ...credentials,
          REPKEY_LOCAL_GOOGLE: 'real',
        }),
      ).toThrow('http://127.0.0.1:3000/api/auth/google/callback')
    }
  })

  it('derives the callback from the stack origin', () => {
    const env: NodeJS.ProcessEnv = {
      ...sandboxEnv(),
      BETTER_AUTH_URL: 'http://localhost:4000',
    }
    expect(googleProviderMode(env).callbackUrl).toBe(
      'http://localhost:4000/api/auth/google/callback',
    )
  })
})

describe('local AI provider mode', () => {
  function stubbedAi(): NodeJS.ProcessEnv {
    return {
      AI_PROVIDER_LOCAL_STUB: 'enabled',
      OPENAI_API_KEY: 'sk-local-ai-provider-stub-not-live',
    }
  }

  it('keeps the stub by default', () => {
    const env = stubbedAi()
    expect(aiProviderMode(env).kind).toBe('stub')
    expect(env.AI_PROVIDER_LOCAL_STUB).toBe('enabled')
  })

  it('drops the stub selector in real mode so the pinned OpenAI connector is built', () => {
    const env: NodeJS.ProcessEnv = {
      ...stubbedAi(),
      REPKEY_LOCAL_AI: 'real',
      OPENAI_API_KEY: `sk-proj-${'a'.repeat(40)}`,
    }
    const mode = aiProviderMode(env)

    expect(mode.kind).toBe('real')
    // A selector left with ANY value keeps provider calls on the stub, so the
    // key must be absent rather than falsy.
    expect('AI_PROVIDER_LOCAL_STUB' in env).toBe(false)
    expect(mode.summary).toContain(AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot)
  })

  it('names the pinned model and the key instead of starting a stack that cannot infer', () => {
    for (const key of [undefined, 'sk-local-ai-provider-stub-not-live', 'not-a-key']) {
      const env: NodeJS.ProcessEnv = { ...stubbedAi(), REPKEY_LOCAL_AI: 'real' }
      if (key === undefined) delete env.OPENAI_API_KEY
      else env.OPENAI_API_KEY = key
      expect(() => aiProviderMode(env)).toThrow('OPENAI_API_KEY')
      expect(() => aiProviderMode(env)).toThrow(
        AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
      )
    }
  })

  it('is independent of the Google posture', () => {
    const env: NodeJS.ProcessEnv = {
      ...sandboxEnv(),
      ...stubbedAi(),
      REPKEY_LOCAL_AI: 'real',
      OPENAI_API_KEY: `sk-${'b'.repeat(40)}`,
    }
    expect(aiProviderMode(env).kind).toBe('real')
    expect(googleProviderMode(env).kind).toBe('sandbox')
    expect(env.GBP_API_BASE_URL).toBe('https://provider-sandbox:4100')
  })
})
