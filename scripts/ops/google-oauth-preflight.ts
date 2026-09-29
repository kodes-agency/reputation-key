// Ask Google whether it will accept the deployed cell's "Connect Google" before
// a person clicks it. Google refuses an unregistered callback address on its own
// `redirect_uri_mismatch` page, where the app never hears about it, so the only
// place to catch it is here: after every deploy (`ops:deploy-ci-images`) and on
// demand (`pnpm ops check-google-oauth`).

import { z } from 'zod/v4'
import {
  buildGoogleAuthorizeUrl,
  googleOAuthCallbackUrl,
} from '../../src/contexts/integration/application/google-authorize-request'
import type { CommandRunner } from './deploy-ci-images'

export type GoogleOAuthConfig = Readonly<{
  baseUrl: string
  clientId: string
  clientSecret: string
}>
type Verdict = 'accepted' | 'rejected' | 'unknown'
export type GoogleOAuthCheck = Readonly<{
  name: 'redirect_uri' | 'client_secret'
  verdict: Verdict
  error: string | null
  detail: string
}>
export type GoogleOAuthReport = Readonly<{
  ok: boolean
  clientId: string
  callbackUrl: string
  checks: readonly GoogleOAuthCheck[]
}>

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const PROBE_TIMEOUT_MS = 15_000
// RFC 7636's example challenge: well formed, and Google stops before using it.
const PROBE_CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
// A code Google never issued: the token endpoint authenticates the client
// first, so a good secret earns `invalid_grant` and a bad one `invalid_client`.
const UNISSUED_CODE = 'repkey-preflight-unissued-code'
const REQUIRED_VARIABLES = [
  'BETTER_AUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const
const OAUTH_ERROR =
  /redirect_uri_mismatch|invalid_client|deleted_client|disabled_client|unauthorized_client|invalid_request/u
const REJECTED_CLIENT = new Set([
  'invalid_client',
  'unauthorized_client',
  'deleted_client',
])
const TOKEN_ERROR_BODY = z.object({ error: z.string().optional() })

/** The OAuth error code Google packs into its error page's `authError`. */
export function decodeGoogleAuthError(location: string): string | null {
  let authError: string | null
  try {
    authError = new URL(location).searchParams.get('authError')
  } catch {
    return null
  }
  if (!authError) return null
  // A protobuf message whose first field (tag 0x0a) is the error code.
  const bytes = Buffer.from(authError, 'base64url')
  const length = bytes[1]
  if (bytes[0] === 0x0a && length !== undefined && length < 0x80) {
    const code = bytes.subarray(2, 2 + length).toString('utf8')
    if (/^[a-z_]+$/u.test(code)) return code
  }
  return bytes.toString('latin1').match(OAUTH_ERROR)?.[0] ?? 'unrecognised_error'
}

const check = (
  name: GoogleOAuthCheck['name'],
  verdict: Verdict,
  detail: string,
  error: string | null = null,
): GoogleOAuthCheck => ({ name, verdict, error, detail })

async function probeRedirectUri(
  config: GoogleOAuthConfig,
  callbackUrl: string,
  fetchImpl: typeof fetch,
): Promise<GoogleOAuthCheck> {
  const url = buildGoogleAuthorizeUrl({
    clientId: config.clientId,
    callbackUrl,
    state: 'repkey-preflight',
    nonce: 'repkey-preflight',
    codeChallenge: PROBE_CODE_CHALLENGE,
  })
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      const target = new URL(location, url)
      if (
        target.pathname.endsWith('/oauth/error') ||
        target.searchParams.has('authError')
      ) {
        const error = decodeGoogleAuthError(target.href) ?? 'unrecognised_error'
        return check('redirect_uri', 'rejected', `Google answered ${error}`, error)
      }
      if (target.hostname === 'accounts.google.com') {
        return check('redirect_uri', 'accepted', 'Google continued to sign-in')
      }
      return check('redirect_uri', 'unknown', `redirected to ${target.origin}`)
    }
    const error = (await response.text()).match(OAUTH_ERROR)?.[0]
    if (response.status === 400 && error) {
      return check('redirect_uri', 'rejected', `Google answered ${error}`, error)
    }
    return check('redirect_uri', 'unknown', `Google answered HTTP ${response.status}`)
  } catch (error) {
    return check('redirect_uri', 'unknown', errorMessage(error))
  }
}

async function probeClientSecret(
  config: GoogleOAuthConfig,
  callbackUrl: string,
  fetchImpl: typeof fetch,
): Promise<GoogleOAuthCheck> {
  try {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: UNISSUED_CODE,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: callbackUrl,
      }).toString(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const parsed = TOKEN_ERROR_BODY.safeParse(await response.json().catch(() => null))
    const error = parsed.success ? (parsed.data.error ?? null) : null
    if (error === 'invalid_grant') {
      return check('client_secret', 'accepted', 'Google authenticated the client')
    }
    if (error && REJECTED_CLIENT.has(error)) {
      return check('client_secret', 'rejected', `Google answered ${error}`, error)
    }
    return check(
      'client_secret',
      'unknown',
      `Google answered HTTP ${response.status}${error ? ` ${error}` : ''}`,
    )
  } catch (error) {
    return check('client_secret', 'unknown', errorMessage(error))
  }
}

export async function checkGoogleOAuth(
  config: GoogleOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleOAuthReport> {
  const callbackUrl = googleOAuthCallbackUrl(config.baseUrl)
  const checks = [
    await probeRedirectUri(config, callbackUrl, fetchImpl),
    await probeClientSecret(config, callbackUrl, fetchImpl),
  ]
  return {
    ok: checks.every(({ verdict }) => verdict === 'accepted'),
    clientId: config.clientId,
    callbackUrl,
    checks,
  }
}

function consoleUrl(clientId: string): string {
  const projectNumber = /^(\d+)-/u.exec(clientId)?.[1]
  const base = `https://console.cloud.google.com/auth/clients/${clientId}`
  return projectNumber ? `${base}?project=${projectNumber}` : base
}

function describeFailure(report: GoogleOAuthReport, item: GoogleOAuthCheck): string[] {
  const where = `  ${consoleUrl(report.clientId)}`
  if (item.verdict === 'unknown') {
    return [
      `Google OAuth: UNVERIFIED — could not check the ${item.name.replace('_', ' ')} (${item.detail}); treat "Connect Google" as untested`,
    ]
  }
  if (item.name === 'client_secret') {
    return [
      `Google OAuth: FAIL — Google refuses the client secret (${item.error}); set GOOGLE_CLIENT_SECRET on web and worker to the client's current secret`,
      where,
    ]
  }
  if (item.error === 'redirect_uri_mismatch') {
    return [
      `Google OAuth: FAIL — Google refuses the callback address (redirect_uri_mismatch), so "Connect Google" stops on Google's error page`,
      `  Add this exact Authorized redirect URI to OAuth client ${report.clientId}:`,
      `    ${report.callbackUrl}`,
      where,
      '  Google can take a few minutes to apply it; re-check with `pnpm ops check-google-oauth`',
    ]
  }
  return [
    `Google OAuth: FAIL — Google refuses OAuth client ${report.clientId} (${item.error}); check GOOGLE_CLIENT_ID on web and worker`,
    where,
  ]
}

/** Human-readable lines; never includes the client secret. */
export function formatGoogleOAuthReport(report: GoogleOAuthReport): string[] {
  return report.checks.flatMap((item) => {
    if (item.verdict !== 'accepted') return describeFailure(report, item)
    return item.name === 'redirect_uri'
      ? [
          `Google OAuth: ok — Google accepts ${report.callbackUrl} for client ${report.clientId}`,
        ]
      : ['Google OAuth: ok — Google accepts the client secret']
  })
}

/** The three values the connect flow uses, read from the deployed web service. */
export function readGoogleOAuthConfig(
  runner: CommandRunner,
  targetArgs: readonly string[],
): GoogleOAuthConfig {
  const args = ['variable', 'list', ...targetArgs, '--kv']
  const result = runner('railway', args)
  if (result.status !== 0) {
    // stderr only: stdout of a variable listing holds secrets.
    throw new Error(
      `railway ${args.join(' ')} failed: ${result.stderr.trim() || 'no diagnostic output'}`,
    )
  }
  const values = new Map<string, string>()
  for (const line of result.stdout.split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0)
      values.set(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  const missing = REQUIRED_VARIABLES.filter((name) => !values.get(name))
  if (missing.length > 0) {
    throw new Error(`the web service is missing ${missing.join(', ')}`)
  }
  return {
    baseUrl: values.get('BETTER_AUTH_URL')!,
    clientId: values.get('GOOGLE_CLIENT_ID')!,
    clientSecret: values.get('GOOGLE_CLIENT_SECRET')!,
  }
}

/** Reads, checks and prints; true only when Google accepts both. */
export async function runGoogleOAuthPreflight(
  input: Readonly<{
    runner: CommandRunner
    targetArgs: readonly string[]
    out: (line: string) => void
    fetchImpl?: typeof fetch
  }>,
): Promise<boolean> {
  const config = readGoogleOAuthConfig(input.runner, input.targetArgs)
  const report = await checkGoogleOAuth(config, input.fetchImpl)
  for (const line of formatGoogleOAuthReport(report)) input.out(line)
  return report.ok
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
