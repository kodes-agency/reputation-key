// BQC-6.5 — deterministic GBP (Google Business Profile) stub server.
//
// A small dependency-free node:http server that serves the EXACT HTTP surface
// the app's real adapters call (google-review-api.adapter.ts, gbp-api.adapter.ts,
// google-oauth.adapter.ts, mybusiness-notifications.adapter.ts). The app runs
// its production adapters against this stub through the BQC-6.5 operator
// sandbox seam (GBP_API_BASE_URL & friends, see composition.ts
// applyProviderEndpointOverrides) — no fake adapters are injected anywhere.
//
// Scripting model: tests register namespaced SCOPES (one per Google account)
// via the control endpoint, so spec files never collide even under parallel
// workers. Every API call is RECORDED (method + path + body) for assertions
// such as "zero reply-upsert calls reached Google after the disconnect".
//
// Control surface (never recorded):
//   GET  /__control/health                  → 200 'ok'
//   POST /__control/scope                   body: StubScope — upsert one account scope
//   POST /__control/reply-behavior          body: { accountName, behavior }
//   POST /__control/fetch-behavior          body: { accountName, locationName?, behavior }
//   POST /__control/performance-behavior    body: { locationName, behavior }
//   GET  /__control/calls?method=..&pathPrefix=.. → recorded calls (filtered)
//   POST /__control/reset                   → clear all scopes + recorded calls
//
// Reply behavior modes (per scope):
//   { mode: 'success' }                          → PUT reply → 200
//   { mode: 'fail-then-success', status, failures } → first `failures` PUTs → status, then 200
//   { mode: 'always-fail', status }              → every PUT → status
// On a successful PUT the stub records the reply onto the scripted review
// (GBP's reply upsert semantics), so subsequent reads see it — like Google.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

export const GBP_STUB_PORT = 4100
export const GBP_STUB_BASE_URL =
  process.env.GBP_STUB_BASE_URL ?? `http://localhost:${GBP_STUB_PORT}`

/**
 * BQC-6.5 sandbox env: point every provider endpoint the app consumes at the
 * stub. Spread into the web + worker process env by the Playwright harness.
 */
export const GBP_SANDBOX_ENV = {
  GOOGLE_PROVIDER_ENDPOINT_PROFILE: 'local-sandbox',
  GBP_ACCOUNT_MANAGEMENT_BASE_URL: GBP_STUB_BASE_URL,
  GBP_API_BASE_URL: GBP_STUB_BASE_URL,
  GBP_PERFORMANCE_BASE_URL: GBP_STUB_BASE_URL,
  GBP_REVIEWS_API_BASE_URL: GBP_STUB_BASE_URL,
  GBP_NOTIFICATIONS_API_BASE_URL: GBP_STUB_BASE_URL,
  GOOGLE_OAUTH_TOKEN_URL: `${GBP_STUB_BASE_URL}/oauth/token`,
  GOOGLE_OAUTH_USERINFO_URL: `${GBP_STUB_BASE_URL}/oauth/userinfo`,
  GOOGLE_OAUTH_REVOKE_URL: `${GBP_STUB_BASE_URL}/oauth/revoke`,
} as const

// ── Scripted data shapes (mirror the adapters' expectations) ──────────

export type StubReviewer = Readonly<{ displayName?: string; profilePhotoUrl?: string }>

export type StubReview = Readonly<{
  /** Full resource name with account, location, and review segments. */
  name: string
  /** 'ONE'..'FIVE' (GBP wire format) */
  starRating: string
  comment?: string
  reviewer?: StubReviewer
  createTime: string
  reviewReply?: { comment: string; updateTime: string }
}>

/** GBP wire star names to their numeric value. */
const STUB_STAR_VALUES: Readonly<Record<string, number | undefined>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

export type StubLocation = Readonly<{
  /** Full resource name with account and location segments. */
  name: string
  title: string
  storefrontAddress?: Record<string, unknown>
  categories?: Record<string, unknown>
  latlng?: Record<string, unknown>
}>

export type StubAccount = Readonly<{
  /** Full account resource name. */
  name: string
  accountName: string
  role?: 'PRIMARY_OWNER' | 'OWNER' | 'MANAGER' | 'SITE_MANAGER'
}>

export type FetchBehavior =
  | Readonly<{ mode: 'success' }>
  | Readonly<{
      mode: 'fail-then-success'
      status: number
      failures: number
      retryAfterSeconds?: number
    }>
  | Readonly<{ mode: 'always-fail'; status: number; retryAfterSeconds?: number }>

export type PerformanceBehavior =
  | Readonly<{ mode: 'success' }>
  | Readonly<{ mode: 'delay'; delayMs: number }>
  | Readonly<{ mode: 'status'; status: number; retryAfterSeconds?: number }>
  | Readonly<{ mode: 'malformed' }>
  | Readonly<{ mode: 'oversize'; bytes: number }>

export type StubPerformanceFixture = Readonly<{
  response: unknown
  behavior?: PerformanceBehavior
}>
export type ReplyBehavior =
  | Readonly<{ mode: 'success' }>
  | Readonly<{ mode: 'fail-then-success'; status: number; failures: number }>
  | Readonly<{ mode: 'always-fail'; status: number }>

export type StubScope = Readonly<{
  account: StubAccount
  locations: readonly StubLocation[]
  /** locationName → scripted review set (served by fetchReviews + batchGet) */
  reviews: Record<string, readonly StubReview[]>
  replyBehavior?: ReplyBehavior
  /** location resource name → scripted Performance API response. */
  performance?: Record<string, StubPerformanceFixture>
}>

export type RecordedCall = Readonly<{
  at: string
  method: string
  path: string
  body?: string
}>

// ── Server ────────────────────────────────────────────────────────────

type MutableScope = {
  account: StubAccount
  locations: StubLocation[]
  reviews: Map<string, StubReview[]>
  fetchBehavior: FetchBehavior
  fetchBehaviorByLocation: Map<string, FetchBehavior>
  replyBehavior: ReplyBehavior
  performance: Map<string, { response: unknown; behavior: PerformanceBehavior }>
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {})
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(payload)
}

function gbpError(status: number, message: string) {
  return {
    error: {
      code: status,
      message,
      status: status === 403 ? 'PERMISSION_DENIED' : 'UNKNOWN',
    },
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function parseFetchBehaviorCommand(
  body: string,
):
  | Readonly<{ accountName: string; locationName?: string; behavior: FetchBehavior }>
  | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  // `typeof === 'object'` narrows to `object`, whose fields are unreadable; the
  // per-field `typeof` checks below are what actually validate this payload.
  const { accountName, locationName, behavior } = parsed as Readonly<
    Record<string, unknown>
  >
  if (
    typeof accountName !== 'string' ||
    (locationName !== undefined && typeof locationName !== 'string') ||
    typeof behavior !== 'object' ||
    behavior == null ||
    Array.isArray(behavior)
  ) {
    return undefined
  }

  const { mode, status, failures, retryAfterSeconds } = behavior as Readonly<
    Record<string, unknown>
  >
  if (mode === 'success') {
    return {
      accountName,
      ...(locationName === undefined ? {} : { locationName }),
      behavior: { mode },
    }
  }
  if (
    (mode !== 'always-fail' && mode !== 'fail-then-success') ||
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    (retryAfterSeconds !== undefined &&
      (typeof retryAfterSeconds !== 'number' ||
        !Number.isInteger(retryAfterSeconds) ||
        retryAfterSeconds < 0))
  ) {
    return undefined
  }
  if (mode === 'always-fail') {
    return {
      accountName,
      ...(locationName === undefined ? {} : { locationName }),
      behavior:
        retryAfterSeconds === undefined
          ? { mode, status }
          : { mode, status, retryAfterSeconds },
    }
  }
  if (typeof failures !== 'number' || !Number.isInteger(failures) || failures < 0) {
    return undefined
  }
  return {
    accountName,
    ...(locationName === undefined ? {} : { locationName }),
    behavior:
      retryAfterSeconds === undefined
        ? { mode, status, failures }
        : { mode, status, failures, retryAfterSeconds },
  }
}

function parsePerformanceBehaviorCommand(
  body: string,
): Readonly<{ locationName: string; behavior: PerformanceBehavior }> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const { locationName, behavior } = parsed as Readonly<Record<string, unknown>>
  if (
    typeof locationName !== 'string' ||
    locationName.length < 1 ||
    locationName.length > 512 ||
    typeof behavior !== 'object' ||
    behavior === null ||
    Array.isArray(behavior)
  ) {
    return undefined
  }

  const { mode, delayMs, status, retryAfterSeconds, bytes } = behavior as Readonly<
    Record<string, unknown>
  >
  if (mode === 'success' || mode === 'malformed') {
    return { locationName, behavior: { mode } }
  }
  if (
    mode === 'delay' &&
    typeof delayMs === 'number' &&
    Number.isInteger(delayMs) &&
    delayMs >= 0 &&
    delayMs <= 120_000
  ) {
    return { locationName, behavior: { mode, delayMs } }
  }
  if (
    mode === 'status' &&
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599 &&
    (retryAfterSeconds === undefined ||
      (typeof retryAfterSeconds === 'number' &&
        Number.isInteger(retryAfterSeconds) &&
        retryAfterSeconds >= 0 &&
        retryAfterSeconds <= 300))
  ) {
    return {
      locationName,
      behavior:
        retryAfterSeconds === undefined
          ? { mode, status }
          : { mode, status, retryAfterSeconds },
    }
  }
  if (
    mode === 'oversize' &&
    typeof bytes === 'number' &&
    Number.isInteger(bytes) &&
    bytes > 5 * 1024 * 1024 &&
    bytes <= 10 * 1024 * 1024
  ) {
    return { locationName, behavior: { mode, bytes } }
  }
  return undefined
}

export type GbpStub = Readonly<{
  host: string
  port: number
  stop: () => Promise<void>
}>

export type GbpStubTls = Readonly<{
  cert: Buffer
  key: Buffer
}>

export async function startGbpStub(
  port: number = GBP_STUB_PORT,
  host: string = '127.0.0.1',
  tls?: GbpStubTls,
): Promise<GbpStub> {
  const scopes = new Map<string, MutableScope>()
  const calls: RecordedCall[] = []
  const MAX_RECORDED = 10_000

  /** Scopes are keyed by the bare account segment ('e2e-x'), while account
   * resource names carry the 'accounts/' prefix — normalize at both edges. */
  const scopeKey = (accountName: string): string =>
    accountName.startsWith('accounts/')
      ? accountName.slice('accounts/'.length)
      : accountName

  const scopeFor = (accountName: string): MutableScope | undefined =>
    scopes.get(scopeKey(accountName))

  const performanceFixtureForName = (
    locationName: string,
  ): { response: unknown; behavior: PerformanceBehavior } | undefined => {
    for (const scope of scopes.values()) {
      const fixture = scope.performance.get(locationName)
      if (fixture) return fixture
    }
    return undefined
  }

  const performanceFixtureForLocationId = (
    locationId: string,
  ): { response: unknown; behavior: PerformanceBehavior } | undefined => {
    for (const scope of scopes.values()) {
      for (const [locationName, fixture] of scope.performance) {
        if (
          locationName === locationId ||
          locationName.endsWith(`/locations/${locationId}`)
        ) {
          return fixture
        }
      }
    }
    return undefined
  }

  const record = (method: string, path: string, body?: string) => {
    if (calls.length < MAX_RECORDED) {
      calls.push({ at: new Date().toISOString(), method, path, body })
    }
  }

  const rejectFetch = (
    res: ServerResponse,
    behavior: Exclude<FetchBehavior, { mode: 'success' }>,
  ): void => {
    if (behavior.retryAfterSeconds !== undefined) {
      res.setHeader('retry-after', String(behavior.retryAfterSeconds))
    }
    json(res, behavior.status, gbpError(behavior.status, 'Scripted fetch failure'))
  }

  /** Applies the first failing behavior in request order and consumes one
   * fail-then-success attempt from the matching account or location script. */
  const applyFetchBehavior = (
    res: ServerResponse,
    scope: MutableScope,
    locationNames: readonly string[],
  ): boolean => {
    for (const locationName of locationNames) {
      const locationOverride = scope.fetchBehaviorByLocation.get(locationName)
      const behavior = locationOverride ?? scope.fetchBehavior
      if (behavior.mode === 'success') continue
      if (behavior.mode === 'fail-then-success' && behavior.failures <= 0) continue

      if (behavior.mode === 'fail-then-success') {
        const next = { ...behavior, failures: behavior.failures - 1 }
        if (locationOverride) {
          scope.fetchBehaviorByLocation.set(locationName, next)
        } else {
          scope.fetchBehavior = next
        }
      }

      rejectFetch(res, behavior)
      return true
    }
    return false
  }
  function pageOffset(pageToken: string | null, prefix: string): number | null {
    if (pageToken === null) return 0
    const separator = pageToken.lastIndexOf(':')
    if (separator <= 0 || pageToken.slice(0, separator) !== prefix) return null
    const offset = Number(pageToken.slice(separator + 1))
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : null
  }

  /** Location-wide mean of the scripted stars, as Google reports it. */
  function averageRating(reviews: readonly StubReview[]): number {
    const stars = reviews.map((review) => STUB_STAR_VALUES[review.starRating] ?? 0)
    return stars.reduce((total, star) => total + star, 0) / stars.length
  }

  function providerPage<T>(
    items: readonly T[],
    offset: number,
    pageSize: number,
    tokenPrefix: string,
  ): Readonly<{ items: readonly T[]; nextPageToken?: string }> {
    const nextOffset = offset + pageSize
    return {
      items: items.slice(offset, nextOffset),
      ...(nextOffset < items.length
        ? { nextPageToken: `${tokenPrefix}:${nextOffset}` }
        : {}),
    }
  }

  const handleApi = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: string,
  ): Promise<void> => {
    const method = req.method ?? 'GET'
    const path = url.pathname

    // ── OAuth surface (token exchange + refresh + userinfo + revoke) ──
    if (path === '/oauth/token' && method === 'POST') {
      json(res, 200, {
        access_token: 'stub-access-token',
        refresh_token: 'stub-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/business.manage',
      })
      return
    }
    if (path === '/oauth/userinfo' && method === 'GET') {
      json(res, 200, {
        id: 'stub-google-user',
        email: 'stub-google@example.com',
        verified_email: true,
        name: 'Stub Google User',
      })
      return
    }
    if (path === '/oauth/revoke' && method === 'POST') {
      json(res, 200, {})
      return
    }

    // ── GBP account-management surface ──
    if (path === '/v1/accounts' && method === 'GET') {
      const offset = pageOffset(url.searchParams.get('pageToken'), 'accounts')
      if (offset === null) {
        json(res, 400, gbpError(400, 'Invalid account page token'))
        return
      }
      const page = providerPage(
        [...scopes.values()]
          .map((scope) => scope.account)
          .sort((left, right) => left.name.localeCompare(right.name)),
        offset,
        20,
        'accounts',
      )
      json(res, 200, {
        accounts: page.items,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      })
      return
    }

    // ── GBP business-information surface ──

    const locationsMatch = /^\/v1\/accounts\/([^/]+)\/locations$/.exec(path)
    if (locationsMatch && method === 'GET') {
      const scope = scopeFor(locationsMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const tokenPrefix = `locations:${scopeKey(locationsMatch[1])}`
      const offset = pageOffset(url.searchParams.get('pageToken'), tokenPrefix)
      if (offset === null) {
        json(res, 400, gbpError(400, 'Invalid location page token'))
        return
      }
      const page = providerPage(scope.locations, offset, 100, tokenPrefix)
      json(res, 200, {
        locations: page.items.map((location) => ({
          ...location,
          name: `locations/${location.name.split('/').at(-1)}`,
        })),
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      })
      return
    }

    const batchReviewsMatch = /^\/accounts\/([^/]+)\/locations:batchGetReviews$/.exec(
      path,
    )
    if (batchReviewsMatch && method === 'POST') {
      const scope = scopeFor(batchReviewsMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const requested =
        (JSON.parse(body || '{}') as { locationNames?: string[] }).locationNames ?? []
      if (applyFetchBehavior(res, scope, requested)) return
      json(res, 200, {
        locationReviews: requested.map((name) => ({
          name,
          reviews: scope.reviews.get(name) ?? [],
        })),
      })
      return
    }

    const locationGetMatch = /^\/accounts\/([^/]+)\/locations\/([^/]+)$/.exec(path)

    const performanceMatch =
      /^\/v1\/locations\/([^/:]+):fetchMultiDailyMetricsTimeSeries$/.exec(path)
    if (performanceMatch && method === 'GET') {
      const fixture = performanceFixtureForLocationId(performanceMatch[1])
      if (!fixture) {
        json(res, 404, gbpError(404, 'Unknown Performance location'))
        return
      }
      const behavior = fixture.behavior
      if (behavior.mode === 'delay') {
        await new Promise((resolve) => setTimeout(resolve, behavior.delayMs))
      } else if (behavior.mode === 'status') {
        if (behavior.retryAfterSeconds !== undefined) {
          res.setHeader('retry-after', String(behavior.retryAfterSeconds))
        }
        json(
          res,
          behavior.status,
          gbpError(behavior.status, 'Scripted Performance failure'),
        )
        return
      } else if (behavior.mode === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"broken"')
        return
      } else if (behavior.mode === 'oversize') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(`{"padding":"${'x'.repeat(behavior.bytes)}"}`)
        return
      }
      json(res, 200, fixture.response)
      return
    }
    if (locationGetMatch && method === 'GET') {
      const scope = scopeFor(locationGetMatch[1])
      const location = scope?.locations.find((l) => l.name === path.slice(1))
      if (!scope || !location) {
        json(res, 404, gbpError(404, 'Unknown location'))
        return
      }
      json(res, 200, location)
      return
    }

    // Notifications surface (unused while GBP_PUBSUB_TOPIC is empty; harmless).
    if (/^\/accounts\/[^/]+\/notificationSetting$/.test(path)) {
      json(res, 200, { name: path.slice(1), notificationTypes: [], pubsubTopic: '' })
      return
    }

    // ── Reviews v4 surface (same path shapes, different adapter base URL) ──
    const reviewsMatch =
      /^(?:\/v4)?\/accounts\/([^/]+)\/locations\/([^/]+)\/reviews$/.exec(path)
    if (reviewsMatch && method === 'GET') {
      const scope = scopeFor(reviewsMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const locationName = `accounts/${reviewsMatch[1]}/locations/${reviewsMatch[2]}`
      if (applyFetchBehavior(res, scope, [locationName])) return
      const reviews = scope.reviews.get(locationName) ?? []
      const tokenPrefix = `reviews:${scopeKey(locationName)}`
      const offset = pageOffset(url.searchParams.get('pageToken'), tokenPrefix)
      if (offset === null) {
        json(res, 400, gbpError(400, 'Invalid review page token'))
        return
      }
      const page = providerPage(reviews, offset, 50, tokenPrefix)
      // Google returns `averageRating` on every non-empty page, and the
      // snapshot validator rejects the page as `malformed_page` without it.
      json(res, 200, {
        reviews: page.items,
        totalReviewCount: reviews.length,
        ...(reviews.length > 0 ? { averageRating: averageRating(reviews) } : {}),
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      })
      return
    }

    const reviewGetMatch =
      /^(?:\/v4)?\/accounts\/([^/]+)\/locations\/([^/]+)\/reviews\/([^/]+)$/.exec(path)
    if (reviewGetMatch && method === 'GET') {
      const scope = scopeFor(reviewGetMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const locationName = `accounts/${reviewGetMatch[1]}/locations/${reviewGetMatch[2]}`
      if (applyFetchBehavior(res, scope, [locationName])) return
      const reviewName = `${locationName}/reviews/${reviewGetMatch[3]}`
      const review = scope.reviews
        .get(locationName)
        ?.find((item) => item.name === reviewName)
      if (!review) {
        json(res, 404, gbpError(404, 'Unknown review'))
        return
      }
      json(res, 200, review)
      return
    }

    const replyMatch =
      /^(?:\/v4)?\/accounts\/([^/]+)\/locations\/([^/]+)\/reviews\/([^/]+)\/reply$/.exec(
        path,
      )
    if (replyMatch && method === 'PUT') {
      const scope = scopeFor(replyMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const behavior = scope.replyBehavior
      if (behavior.mode === 'always-fail') {
        json(res, behavior.status, gbpError(behavior.status, 'Scripted reply failure'))
        return
      }
      if (behavior.mode === 'fail-then-success') {
        const remaining = behavior.failures
        if (remaining > 0) {
          scope.replyBehavior = { ...behavior, failures: remaining - 1 }
          json(
            res,
            behavior.status,
            gbpError(behavior.status, 'Scripted transient failure'),
          )
          return
        }
      }
      // Success: GBP reply upsert — record it onto the scripted review.
      const locationName = `accounts/${replyMatch[1]}/locations/${replyMatch[2]}`
      const reviewName = `${locationName}/reviews/${replyMatch[3]}`
      const comment = (JSON.parse(body || '{}') as { comment?: string }).comment ?? ''
      const reviews = scope.reviews.get(locationName)
      if (reviews) {
        scope.reviews.set(
          locationName,
          reviews.map((r) =>
            r.name === reviewName
              ? { ...r, reviewReply: { comment, updateTime: new Date().toISOString() } }
              : r,
          ),
        )
      }
      json(res, 200, { name: `${reviewName}/reply`, comment })
      return
    }

    json(res, 404, gbpError(404, `Stub has no route for ${method} ${path}`))
  }

  const handleControl = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: string,
  ): Promise<void> => {
    const method = req.method ?? 'GET'
    const path = url.pathname

    if (path === '/__control/health' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (path === '/__control/reset' && method === 'POST') {
      scopes.clear()
      calls.length = 0
      json(res, 200, { ok: true })
      return
    }
    if (path === '/__control/scope' && method === 'POST') {
      const scope = JSON.parse(body) as StubScope
      scopes.set(scopeKey(scope.account.name), {
        account: scope.account,
        locations: [...scope.locations],
        reviews: new Map(Object.entries(scope.reviews).map(([k, v]) => [k, [...v]])),
        fetchBehavior: { mode: 'success' },
        fetchBehaviorByLocation: new Map(),
        replyBehavior: scope.replyBehavior ?? { mode: 'success' },
        performance: new Map(
          Object.entries(scope.performance ?? {}).map(([locationName, fixture]) => [
            locationName,
            {
              response: fixture.response,
              behavior: fixture.behavior ?? { mode: 'success' },
            },
          ]),
        ),
      })
      json(res, 200, { ok: true })
      return
    }
    if (path === '/__control/reply-behavior' && method === 'POST') {
      const { accountName, behavior } = JSON.parse(body) as {
        accountName: string
        behavior: ReplyBehavior
      }
      const scope = scopeFor(accountName)
      if (!scope) {
        json(res, 404, { error: 'Unknown account scope' })
        return
      }
      scope.replyBehavior = behavior
      json(res, 200, { ok: true })
      return
    }
    if (path === '/__control/fetch-behavior' && method === 'POST') {
      const command = parseFetchBehaviorCommand(body)
      if (!command) {
        json(res, 400, { error: 'Invalid fetch behavior command' })
        return
      }
      const { accountName, locationName, behavior } = command
      const scope = scopeFor(accountName)
      if (!scope) {
        json(res, 404, { error: 'Unknown account scope' })
        return
      }
      if (locationName) {
        scope.fetchBehaviorByLocation.set(locationName, behavior)
      } else {
        scope.fetchBehavior = behavior
      }
      json(res, 200, { ok: true })
      return
    }
    if (path === '/__control/performance-behavior' && method === 'POST') {
      const command = parsePerformanceBehaviorCommand(body)
      if (!command) {
        json(res, 400, { error: 'Invalid Performance behavior command' })
        return
      }
      const fixture = performanceFixtureForName(command.locationName)
      if (!fixture) {
        json(res, 404, { error: 'Unknown Performance location' })
        return
      }
      fixture.behavior = command.behavior
      json(res, 200, { ok: true })
      return
    }
    if (path === '/__control/calls' && method === 'GET') {
      const methodFilter = url.searchParams.get('method')
      const pathPrefix = url.searchParams.get('pathPrefix')
      // Prefix matching is slash-tolerant: resource names in specs carry no
      // leading slash while recorded request paths always do.
      const normalizedPrefix = pathPrefix?.replace(/^\/+/, '')
      const filtered = calls.filter((c) => {
        if (methodFilter && c.method !== methodFilter) return false
        if (!normalizedPrefix) return true
        return c.path.replace(/^\/+/, '').startsWith(normalizedPrefix)
      })
      json(res, 200, { calls: filtered })
      return
    }
    json(res, 404, { error: `Unknown control route ${method} ${path}` })
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const body = req.method === 'GET' ? '' : await readBody(req)
      if (url.pathname.startsWith('/__control/')) {
        await handleControl(req, res, url, body)
        return
      }
      record(req.method ?? 'GET', `${url.pathname}${url.search}`, body || undefined)
      await handleApi(req, res, url, body)
    })().catch((err) => {
      json(res, 500, { error: String(err) })
    })
  }
  const server = tls
    ? createHttpsServer({ cert: tls.cert, key: tls.key }, handleRequest)
    : createHttpServer(handleRequest)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  return {
    host,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

// ── Control client (used by specs + orchestration) ────────────────────

async function controlFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${GBP_STUB_BASE_URL}${path}`, init)
  if (!res.ok) {
    throw new Error(
      `GBP stub control ${path} failed: HTTP ${res.status} ${await res.text()}`,
    )
  }
  return res
}

export const gbpStubControl = {
  async health(): Promise<void> {
    await controlFetch('/__control/health')
  },

  async putScope(scope: StubScope): Promise<void> {
    await controlFetch('/__control/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scope),
    })
  },

  async setReplyBehavior(accountName: string, behavior: ReplyBehavior): Promise<void> {
    await controlFetch('/__control/reply-behavior', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountName, behavior }),
    })
  },

  async setPerformanceBehavior(
    locationName: string,
    behavior: PerformanceBehavior,
  ): Promise<void> {
    await controlFetch('/__control/performance-behavior', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locationName, behavior }),
    })
  },

  async calls(filter?: {
    method?: string
    pathPrefix?: string
  }): Promise<RecordedCall[]> {
    const params = new URLSearchParams()
    if (filter?.method) params.set('method', filter.method)
    if (filter?.pathPrefix) params.set('pathPrefix', filter.pathPrefix)
    const res = await controlFetch(`/__control/calls?${params.toString()}`)
    const body = (await res.json()) as { calls: RecordedCall[] }
    return body.calls
  },

  async reset(): Promise<void> {
    await controlFetch('/__control/reset', { method: 'POST' })
  },
}
