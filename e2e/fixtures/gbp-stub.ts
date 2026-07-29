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
//   GET  /__control/health            → 200 'ok'
//   POST /__control/scope             body: StubScope — upsert one account scope
//   POST /__control/reply-behavior    body: { accountName, behavior } — switch modes mid-test
//   GET  /__control/calls?method=..&pathPrefix=.. → recorded calls (filtered)
//   POST /__control/reset             → clear all scopes + recorded calls
//
// Reply behavior modes (per scope):
//   { mode: 'success' }                          → PUT reply → 200
//   { mode: 'fail-then-success', status, failures } → first `failures` PUTs → status, then 200
//   { mode: 'always-fail', status }              → every PUT → status
// On a successful PUT the stub records the reply onto the scripted review
// (GBP's reply upsert semantics), so subsequent reads see it — like Google.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const GBP_STUB_PORT = 4100
export const GBP_STUB_BASE_URL = `http://localhost:${GBP_STUB_PORT}`

/**
 * BQC-6.5 sandbox env: point every provider endpoint the app consumes at the
 * stub. Spread into the web + worker process env by the Playwright harness.
 */
export const GBP_SANDBOX_ENV = {
  GBP_API_BASE_URL: GBP_STUB_BASE_URL,
  GBP_REVIEWS_API_BASE_URL: GBP_STUB_BASE_URL,
  GBP_NOTIFICATIONS_API_BASE_URL: GBP_STUB_BASE_URL,
  GOOGLE_OAUTH_TOKEN_URL: `${GBP_STUB_BASE_URL}/oauth/token`,
  GOOGLE_OAUTH_USERINFO_URL: `${GBP_STUB_BASE_URL}/oauth/userinfo`,
  GOOGLE_OAUTH_REVOKE_URL: `${GBP_STUB_BASE_URL}/oauth/revoke`,
} as const

// ── Scripted data shapes (mirror the adapters' expectations) ──────────

export type StubReviewer = Readonly<{ displayName?: string; profilePhotoUrl?: string }>

export type StubReview = Readonly<{
  /** Full resource name, e.g. accounts/a/locations/l/reviews/r1 */
  name: string
  /** 'ONE'..'FIVE' (GBP wire format) */
  starRating: string
  comment?: string
  reviewer?: StubReviewer
  createTime: string
  reviewReply?: { comment: string; updateTime: string }
}>

export type StubLocation = Readonly<{
  /** Full resource name, e.g. accounts/a/locations/l */
  name: string
  title: string
  storefrontAddress?: Record<string, unknown>
  categories?: Record<string, unknown>
  latlng?: Record<string, unknown>
}>

export type StubAccount = Readonly<{
  /** e.g. accounts/e2e-import-1 */
  name: string
  type?: string
  roleInfo?: { name: string }
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
  replyBehavior: ReplyBehavior
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

export type GbpStub = Readonly<{
  port: number
  stop: () => Promise<void>
}>

export async function startGbpStub(port: number = GBP_STUB_PORT): Promise<GbpStub> {
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

  const record = (method: string, path: string, body?: string) => {
    if (calls.length < MAX_RECORDED) {
      calls.push({ at: new Date().toISOString(), method, path, body })
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

    // ── GBP business-information surface ──
    if (path === '/accounts' && method === 'GET') {
      json(res, 200, { accounts: [...scopes.values()].map((s) => s.account) })
      return
    }

    const locationsMatch = /^\/accounts\/([^/]+)\/locations$/.exec(path)
    if (locationsMatch && method === 'GET') {
      const scope = scopeFor(locationsMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      json(res, 200, { locations: scope.locations })
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
      json(res, 200, {
        locationReviews: requested.map((name) => ({
          name,
          reviews: scope.reviews.get(name) ?? [],
        })),
      })
      return
    }

    const locationGetMatch = /^\/accounts\/([^/]+)\/locations\/([^/]+)$/.exec(path)
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
    const reviewsMatch = /^\/accounts\/([^/]+)\/locations\/([^/]+)\/reviews$/.exec(path)
    if (reviewsMatch && method === 'GET') {
      const scope = scopeFor(reviewsMatch[1])
      if (!scope) {
        json(res, 404, gbpError(404, 'Unknown account'))
        return
      }
      const locationName = `accounts/${reviewsMatch[1]}/locations/${reviewsMatch[2]}`
      json(res, 200, { reviews: scope.reviews.get(locationName) ?? [] })
      return
    }

    const replyMatch =
      /^\/accounts\/([^/]+)\/locations\/([^/]+)\/reviews\/([^/]+)\/reply$/.exec(path)
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
        replyBehavior: scope.replyBehavior ?? { mode: 'success' },
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

  const server = createServer((req, res) => {
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
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return {
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
