// Which providers the local stack talks to: the Compose stubs by default, or
// the real Google and the real OpenAI, selected per provider in the gitignored
// `local.env` overlay.
//
// Google — `e2e/stack.env` selects `GOOGLE_PROVIDER_ENDPOINT_PROFILE=local-sandbox`
// and pins every GBP/OAuth base URL at `provider-sandbox:4100`.
// `REPKEY_LOCAL_GOOGLE=real` removes those pins so the app resolves Google's own
// approved endpoints (`composition/provider-runtime.ts` GOOGLE_PROVIDER_ENDPOINTS)
// and runs the real OAuth handshake, the real Account Management + Business
// Information imports, and the real review sync. Nothing about that path is
// production-only: outside `NODE_ENV=production` the four provider keyrings
// derive local fallbacks from `OAUTH_STATE_SECRET` and the opaque OAuth state
// lives in an in-memory provider-ephemeral store
// (`composition/google-provider-authority.ts`). The only Google-side
// prerequisite is a client whose authorised redirect URI is this stack's
// callback, which `googleProviderMode` prints and refuses to guess.
//
// AI — `e2e/stack.env` sets `AI_PROVIDER_LOCAL_STUB=enabled`, the selector that
// routes provider calls to the compiled-in stub address
// (`shared/ai-provider-control/local-provider-fetch.ts`).
// `REPKEY_LOCAL_AI=real` drops the selector, so the gateway builds its pinned
// `api.openai.com` connector instead; every HMAC/Ed25519 keyring the gateway,
// admission and provenance need is already in `e2e/stack.env`, because the
// stubbed path builds the same runtime. Only the API key is missing, and it
// buys real inference on a real account.

import { readFileSync } from 'node:fs'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '../../src/shared/ai-operation-profiles'

/** Every endpoint `applyProviderEndpointOverrides` may override. */
const SANDBOX_ENDPOINT_PINS = Object.freeze([
  'GBP_ACCOUNT_MANAGEMENT_BASE_URL',
  'GBP_API_BASE_URL',
  'GBP_NOTIFICATIONS_API_BASE_URL',
  'GBP_PERFORMANCE_BASE_URL',
  'GBP_REVIEWS_API_BASE_URL',
  'GOOGLE_OAUTH_JWKS_URL',
  'GOOGLE_OAUTH_REVOKE_URL',
  'GOOGLE_OAUTH_TOKEN_URL',
] as const)

const REAL_CLIENT_ID = /^\d+-[0-9a-z]+\.apps\.googleusercontent\.com$/u

const REAL_OPENAI_KEY = /^sk-[A-Za-z0-9_-]{20,}$/u

export type GoogleProviderMode = Readonly<{
  kind: 'sandbox' | 'real'
  /** The redirect URI this stack sends Google, i.e. what must be registered. */
  callbackUrl: string
  summary: string
}>

/**
 * Parse a `KEY=VALUE` overlay. An empty value UNSETS the variable, which is
 * how a caller drops a pin from `e2e/stack.env` (the app's schema treats an
 * empty string as a value, not as absence).
 */
export function parseEnvOverlay(text: string): ReadonlyMap<string, string | undefined> {
  const overlay = new Map<string, string | undefined>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    const key = line.slice(0, equals).trim()
    let value = line.slice(equals + 1).trim()
    const comment = value.indexOf(' #')
    if (comment >= 0) value = value.slice(0, comment).trim()
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      /^["']$/u.test(value[0]!)
    ) {
      value = value.slice(1, -1)
    }
    overlay.set(key, value.length === 0 ? undefined : value)
  }
  return overlay
}

/** Apply an overlay file if it exists; returns the keys it touched. */
export function applyEnvOverlay(
  env: NodeJS.ProcessEnv,
  path: string,
): ReadonlyArray<string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const overlay = parseEnvOverlay(text)
  for (const [key, value] of overlay) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return [...overlay.keys()]
}

/**
 * Resolve the Google posture, mutating `env` for the real one. Throws with the
 * exact missing prerequisite rather than starting a stack that would fail at
 * the consent screen.
 */
export function googleProviderMode(env: NodeJS.ProcessEnv): GoogleProviderMode {
  const callbackUrl = `${env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'}/api/auth/google/callback`
  if (env.REPKEY_LOCAL_GOOGLE !== 'real') {
    return Object.freeze({
      kind: 'sandbox' as const,
      callbackUrl,
      summary: [
        'Google: Compose sandbox (provider-sandbox:4100) - no real API call leaves this machine.',
        '  "Connect Google" still points at accounts.google.com (the authorize host is',
        '  pinned by the provider contract) and the sandbox client id is a placeholder,',
        "  so clicking it lands on Google's `Error 401: invalid_client`. Either set",
        '  REPKEY_LOCAL_GOOGLE=real in local.env, or bind a property by running the',
        '  google-import-sync workflow against this stack (see README).',
      ].join('\n'),
    })
  }

  const clientId = env.GOOGLE_CLIENT_ID ?? ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET ?? ''
  const missing: string[] = []
  if (!REAL_CLIENT_ID.test(clientId))
    missing.push('GOOGLE_CLIENT_ID (…apps.googleusercontent.com)')
  if (clientSecret.length === 0 || clientSecret.startsWith('local-')) {
    missing.push('GOOGLE_CLIENT_SECRET (the real client secret)')
  }
  if (missing.length > 0) {
    throw new Error(
      [
        'REPKEY_LOCAL_GOOGLE=real needs real OAuth credentials in local.env:',
        ...missing.map((name) => `  - ${name}`),
        '',
        'The client must live in the same Google Cloud project as production (the',
        'Business Profile API allowlist is per project) and must carry this exact',
        `authorised redirect URI:\n  ${callbackUrl}`,
      ].join('\n'),
    )
  }

  for (const pin of SANDBOX_ENDPOINT_PINS) delete env[pin]
  env.GOOGLE_PROVIDER_ENDPOINT_PROFILE = 'production-fixed'
  return Object.freeze({
    kind: 'real' as const,
    callbackUrl,
    summary: [
      'Google: LIVE (accounts.google.com + googleapis.com).',
      `  redirect URI this stack sends: ${callbackUrl}`,
      '  real Business Profile quota is consumed and real reviewer data lands in',
      '  the local database - `pnpm local:down` deletes that volume.',
    ].join('\n'),
  })
}

export type AiProviderMode = Readonly<{
  kind: 'stub' | 'real'
  summary: string
}>

/**
 * Resolve the AI posture, mutating `env` for the real one. The stub selector is
 * dropped rather than overwritten: it is an `z.enum(['enabled'])` selector, so
 * any value at all keeps provider calls on the stub.
 */
export function aiProviderMode(env: NodeJS.ProcessEnv): AiProviderMode {
  if (env.REPKEY_LOCAL_AI !== 'real') {
    return Object.freeze({
      kind: 'stub' as const,
      summary:
        'AI: Compose stub (ai-provider-stub:4102) - synthesized answers, no OpenAI call, no spend',
    })
  }

  const apiKey = env.OPENAI_API_KEY ?? ''
  if (!REAL_OPENAI_KEY.test(apiKey) || apiKey.startsWith('sk-local-')) {
    throw new Error(
      [
        'REPKEY_LOCAL_AI=real needs a real OPENAI_API_KEY in local.env.',
        '',
        `The account must be able to call the pinned model snapshot ${AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot}`,
        '(GET https://api.openai.com/v1/models/' +
          AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot +
          ' must answer 200);',
        'an unavailable model is refused by the gateway as output_invalid.',
      ].join('\n'),
    )
  }

  delete env.AI_PROVIDER_LOCAL_STUB
  return Object.freeze({
    kind: 'real' as const,
    summary: [
      `AI: LIVE (api.openai.com, model ${AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot}).`,
      '  every enabled capability spends real tokens, and the redacted review text',
      '  plus the property display name leave this machine under the consented',
      '  notice - enable AI per property in Settings before it can run.',
    ].join('\n'),
  })
}
