// BQC-6.5 — scenario fixtures for the critical workflow suite.
//
// Fixtures do SETUP and SYSTEM-LEVEL assertions directly against the e2e DB /
// queues / GBP stub control surface; specs drive the real UI for every
// user-visible transition. Everything here is raw SQL over a dedicated pg
// pool (no app imports beyond the BQC-6.1 test-environment builder, so the
// Playwright process never boots app code) plus BullMQ enqueues against the
// same queue names the app uses.
//
// Determinism: every fixture entity name carries `e2eRunId` (unique per test
// worker process per run), so repeated suite runs never hit unique
// constraints and parallel files never collide on the shared seeded org.
// `cleanupE2eData` deletes prefix-scoped rows in FK-safe order.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '../../test-fixtures/generated/google-provider-identifiers-v1'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import type { Page } from '@playwright/test'
import { testEnvironment } from '../../src/shared/testing/test-environment'
import { computeAiReviewSourceProvenance } from '../../src/contexts/review/application/ai-review-source'

/**
 * Unique-per-run marker for every fixture-created external identifier.
 *
 * Playwright workers fork together, so the millisecond prefix routinely ties
 * and the suffix is the only thing separating two workers. The suffix was
 * `Math.floor(Math.random() * 1296).toString(36)`: 1296 values, and only ONE
 * character whenever the draw landed below 36, so the id was not even a fixed
 * width. Two random bytes give a uniform 4 characters and 65536 values. A tie
 * here does not fail as a tie — it surfaces as an unrelated unique-constraint
 * violation in whichever spec loses the race, which is why it is worth the
 * widening rather than the explanation.
 */
export const e2eRunId = `r${Date.now().toString(36)}${randomBytes(2).toString('hex')}`

const TEST_ENV = testEnvironment()

// ── DB access ─────────────────────────────────────────────────────────

let _pool: Pool | undefined

function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: TEST_ENV.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10_000,
      // Let the Playwright worker process exit when the suite is done even
      // though the pool is never explicitly closed.
      allowExitOnIdle: true,
    })
  }
  return _pool
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool().query(text, params as unknown[])
  return result.rows as T[]
}

// ── Token encryption (must match token-encryption.adapter.ts) ─────────

/** AES-256-GCM, format base64(iv):base64(authTag):base64(ciphertext). */
export function encryptToken(plaintext: string): string {
  const key = Buffer.from(TEST_ENV.ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`
}

// ── Polling ───────────────────────────────────────────────────────────

/**
 * Thrown by a probe to say "the thing being waited for can no longer happen".
 *
 * A probe has three distinct things to communicate and only had two ways to say
 * them: `null` for "not yet" and a throw for "transient error, keep trying".
 * A subject that reached a TERMINAL state the caller was not waiting for is
 * neither — it will never become true, so polling on is pure waste. The Google
 * import wait burned its FULL budget three times (30s, then 60s, then 90s
 * across 335 healthy probes) on an import that had already finished as
 * `completed_with_issues`, and each failure was misread as a slow worker and
 * "fixed" by raising the bound.
 */
export class WaitBailedError extends Error {
  readonly bailed = true
  constructor(description: string, observed: unknown) {
    super(
      `waitFor bailed: ${description} reached a terminal state: ${JSON.stringify(observed)}`,
    )
    this.name = 'WaitBailedError'
  }
}

/** Abort a `waitFor` immediately — the awaited condition is now unreachable. */
export function bailWait(description: string, observed: unknown): never {
  throw new WaitBailedError(description, observed)
}

/**
 * Default budget for a `waitFor` that does not name one.
 *
 * Convention: a wait that polls a REAL BACKGROUND WORKER (outbox relay, BullMQ
 * job, import processor) omits `timeoutMs` and passes `diagnose`. 90s is not a
 * guess about how slow the worker is — it is the ceiling that keeps a loaded
 * runner from being reported as a wedged system. The assertions after the wait
 * are what prove the behaviour; the budget only bounds the wrong answer.
 *
 * Waits on a synchronous read (a DB row a server fn just wrote, a rendered
 * element) should still pass an explicit short budget — a 90s wait on those
 * hides a real hang for 90 seconds.
 *
 * History: 30s and 45s budgets on worker-polling waits produced two of this
 * suite's three known flake signatures (reply-lifecycle terminal-403 at 30s,
 * transient-retry at 45s), each costing a ~10-minute CI rerun to classify.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 90_000

export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: {
    /** Omit for worker-polling waits — see DEFAULT_WAIT_TIMEOUT_MS. */
    timeoutMs?: number
    intervalMs?: number
    description: string
    /**
     * Called ONCE, only on timeout, to say what the world actually looked like.
     *
     * A probe signals "not yet" by returning null, so on timeout the helper
     * otherwise has nothing to report and the failure reads
     * `waitFor timed out after 60000ms: <description>` — which cannot
     * distinguish a slow-but-progressing background worker from a wedged one.
     * That is the difference between a flake to re-run and a bug to fix, and
     * every one of these call sites was throwing it away.
     *
     * Must not throw: if it does, the reason is reported instead of the value,
     * because a diagnostic that masks the real timeout is worse than none.
     */
    diagnose?: () => Promise<unknown>
  },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const interval = options.intervalMs ?? 250
  let lastError: unknown
  let attempts = 0
  while (Date.now() < deadline) {
    try {
      attempts += 1
      const value = await probe()
      if (value) return value
    } catch (err) {
      // A bail is not a transient failure: the subject settled somewhere the
      // caller was not waiting for, so retrying cannot change the answer.
      if (err instanceof WaitBailedError) throw err
      lastError = err
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  let observed = ''
  if (options.diagnose) {
    try {
      observed = ` (last observed: ${JSON.stringify(await options.diagnose())})`
    } catch (err) {
      observed = ` (diagnose failed: ${String(err)})`
    }
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms across ${attempts} probe(s): ${options.description}` +
      (lastError ? ` (last error: ${String(lastError)})` : '') +
      observed,
  )
}

// ── Server-fn RPC (TanStack Start dev wire format) ────────────────────
//
// The wire contract (verified against @tanstack/start-server-core
// server-functions-handler.js + start-client-core serverFnFetcher.js):
//   - fn id (dev): base64url(JSON{ file: '/<repo-relative>?tss-serverfn-split',
//     export: '<name>_createServerFn_handler' }) at /_serverFn/<id>
//   - request payload: seroval JSON tree of { data } (toJSONAsync), POST body
//     or ?payload= query for GET fns
//   - success response: HTTP 200, seroval CROSS-JSON of { result } — app-level
//     fn errors may instead surface as { error } in the same envelope
//   - thrown errors: HTTP 4xx/5xx (intended status via the response ALS),
//     seroval CROSS-JSON of the Error itself
// seroval is not a direct dependency (pnpm strict), so it is resolved at
// runtime through the app's own dependency chain — always the same version
// the server uses.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

type SerovalCodec = Readonly<{
  toJSONAsync: (value: unknown) => Promise<unknown>
  fromCrossJSON: (tree: unknown, options: { plugins: unknown[] }) => unknown
  plugins: unknown[]
}>

let _codec: SerovalCodec | undefined

/**
 * seroval + the app's seroval plugins, resolved through the app's own
 * dependency chain (seroval/router-core are not direct dependencies — pnpm
 * strict — so they cannot be imported by name here; the chain always yields
 * the exact versions the running server serializes with). The app configures
 * no custom serializationAdapters (vite.config.ts), so the server's plugin
 * set is exactly router-core's defaultSerovalPlugins — see
 * start-client-core getDefaultSerovalPlugins.js.
 */
async function codec(): Promise<SerovalCodec> {
  if (!_codec) {
    const req = createRequire(import.meta.url)
    const reactRouterPkg = req.resolve('@tanstack/react-router/package.json')
    const routerCorePkg = req.resolve('@tanstack/router-core/package.json', {
      paths: [reactRouterPkg],
    })
    const reactStartPkg = req.resolve('@tanstack/react-start/package.json')
    const clientCorePkg = req.resolve('@tanstack/start-client-core/package.json', {
      paths: [reactStartPkg],
    })
    const seroval = req(req.resolve('seroval', { paths: [clientCorePkg] })) as {
      toJSONAsync: SerovalCodec['toJSONAsync']
      fromCrossJSON: SerovalCodec['fromCrossJSON']
    }
    const routerCore = (await import(
      pathToFileURL(join(dirname(routerCorePkg), 'dist/esm/index.js')).href
    )) as { defaultSerovalPlugins: unknown[] }
    _codec = { ...seroval, plugins: routerCore.defaultSerovalPlugins }
  }
  return _codec
}

/**
 * TanStack Start server-function URL. Dev uses a base64url module descriptor;
 * production uses SHA-256 of `<file>--<generated handler export>`.
 */
export function serverFnUrl(file: string, exportName: string): string {
  const handlerExport = `${exportName}_createServerFn_handler`
  const id = process.env.E2E_EXTERNAL_STACK
    ? createHash('sha256').update(`${file}--${handlerExport}`).digest('hex')
    : Buffer.from(
        JSON.stringify({
          file: `/${file}?tss-serverfn-split`,
          export: handlerExport,
        }),
      ).toString('base64url')
  return `/_serverFn/${id}`
}

export type ServerFnErrorBody = Readonly<{
  name?: string
  message?: string
  code?: string
  status?: number
}>

export type ServerFnRawResult = Readonly<{
  httpStatus: number
  result?: unknown
  error?: ServerFnErrorBody
}>

function normalizeError(value: unknown, httpStatus: number): ServerFnErrorBody {
  if (value instanceof Error) {
    const tagged = value as Error & { code?: string; status?: number }
    return {
      name: value.name,
      message: value.message,
      code: tagged.code,
      status: tagged.status ?? httpStatus,
    }
  }
  if (value && typeof value === 'object') {
    const body = value as Record<string, unknown>
    return {
      name: typeof body.name === 'string' ? body.name : undefined,
      message: typeof body.message === 'string' ? body.message : JSON.stringify(value),
      code: typeof body.code === 'string' ? body.code : undefined,
      status: typeof body.status === 'number' ? body.status : httpStatus,
    }
  }
  return { message: String(value), status: httpStatus }
}

async function parseServerFnResponse(res: {
  status(): number
  text(): Promise<string>
}): Promise<ServerFnRawResult> {
  const httpStatus = res.status()
  const text = await res.text()
  if (!text) {
    return httpStatus >= 400
      ? {
          httpStatus,
          error: { message: `HTTP ${httpStatus} (empty body)`, status: httpStatus },
        }
      : { httpStatus }
  }
  let decoded: unknown
  try {
    decoded = (await codec()).fromCrossJSON(JSON.parse(text), {
      plugins: (await codec()).plugins,
    })
  } catch {
    // Non-seroval body (framework-level error page, 405, etc.)
    return httpStatus >= 400
      ? { httpStatus, error: { message: text.slice(0, 300), status: httpStatus } }
      : { httpStatus, result: text }
  }
  if (httpStatus >= 400 || decoded instanceof Error) {
    return { httpStatus, error: normalizeError(decoded, httpStatus) }
  }
  if (decoded && typeof decoded === 'object') {
    const envelope = decoded as Record<string, unknown>
    if (envelope.error) {
      return { httpStatus, error: normalizeError(envelope.error, httpStatus) }
    }
    if ('result' in envelope) {
      return { httpStatus, result: envelope.result }
    }
  }
  return { httpStatus, result: decoded }
}

type BrowserServerFnResponse = Readonly<{
  status: number
  text: string
}>

async function browserServerFnRequest(
  page: Page,
  input: Readonly<{ url: string; method: 'GET' | 'POST'; body?: string }>,
): Promise<{ status(): number; text(): Promise<string> }> {
  const current = new URL(page.url())
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    throw new Error('Server fn calls require a page loaded from the application origin')
  }
  const response = await page.evaluate(
    async ({ url, method, body }): Promise<BrowserServerFnResponse> => {
      const result = await fetch(url, {
        method,
        body,
        credentials: 'same-origin',
        headers: {
          'x-tsr-serverFn': 'true',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      })
      return { status: result.status, text: await result.text() }
    },
    input,
  )
  return {
    status: () => response.status,
    text: async () => response.text,
  }
}

/** POST a server fn; throws when the fn returned a serialized error. */
export async function callServerFn<T = unknown>(
  page: Page,
  fn: { file: string; exportName: string; data: unknown },
): Promise<T> {
  const body = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const res = await browserServerFnRequest(page, {
    url: serverFnUrl(fn.file, fn.exportName),
    method: 'POST',
    body,
  })
  const parsed = await parseServerFnResponse(res)
  if (parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} failed: ${parsed.error.code ?? parsed.error.name} — ${parsed.error.message}`,
    )
  }
  return parsed.result as T
}

/** POST a server fn expecting a denial; returns the serialized error body. */
export async function callServerFnExpectError(
  page: Page,
  fn: { file: string; exportName: string; data: unknown },
): Promise<ServerFnErrorBody> {
  const body = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const res = await browserServerFnRequest(page, {
    url: serverFnUrl(fn.file, fn.exportName),
    method: 'POST',
    body,
  })
  const parsed = await parseServerFnResponse(res)
  if (!parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} was expected to fail but returned: ${JSON.stringify(parsed.result)}`,
    )
  }
  return parsed.error
}

/** GET a server fn (query-param payload encoding). */
export async function callServerFnGet<T = unknown>(
  page: Page,
  fn: { file: string; exportName: string; data?: unknown },
): Promise<T> {
  const serialized = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const url = `${serverFnUrl(fn.file, fn.exportName)}?payload=${encodeURIComponent(serialized)}`
  const res = await browserServerFnRequest(page, { url, method: 'GET' })
  const parsed = await parseServerFnResponse(res)
  if (parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} failed: ${parsed.error.code ?? parsed.error.name} — ${parsed.error.message}`,
    )
  }
  return parsed.result as T
}

/** GET a server fn expecting a denial; returns the serialized error body. */
export async function callServerFnGetExpectError(
  page: Page,
  fn: { file: string; exportName: string; data?: unknown },
): Promise<ServerFnErrorBody> {
  const serialized = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const url = `${serverFnUrl(fn.file, fn.exportName)}?payload=${encodeURIComponent(serialized)}`
  const res = await browserServerFnRequest(page, { url, method: 'GET' })
  const parsed = await parseServerFnResponse(res)
  if (!parsed.error) {
    throw new Error(
      `Server fn ${fn.exportName} was expected to fail but returned: ${JSON.stringify(parsed.result)}`,
    )
  }
  return parsed.error
}

// ── Identity / access fixtures ────────────────────────────────────────

export async function getUserByEmail(
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const rows = await dbQuery<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM "user" WHERE email = $1',
    [email],
  )
  return rows[0] ?? null
}

/**
 * A staff member: better-auth user (credential account) + member row (role
 * 'member' → Staff permissions) + an ACTIVE property_access_grant with
 * source 'operator' (the operator-allowlist provenance). The user id is a
 * UUID so the user is a valid assignment target (assignInboxItemFn validates
 * assignedToUserId as uuid — better-auth's own nanoid ids fail it; see the
 * slice report).
 */
export async function seedStaffUserWithGrant(input: {
  organizationId: string
  propertyId: string
  email: string
  name?: string
  password?: string
}): Promise<{ userId: string; email: string; password: string }> {
  const userId = randomUUID()
  const password = input.password ?? 'StaffPass123!'
  const passwordHash = await hashPassword(password)

  await dbQuery(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())',
    [userId, input.name ?? 'E2E Staff', input.email],
  )
  await dbQuery(
    'INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, now(), now())',
    [`e2e-${randomUUID()}`, userId, 'credential', userId, passwordHash],
  )
  await dbQuery(
    'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())',
    [`e2e-${randomUUID()}`, input.organizationId, userId, 'member'],
  )
  await dbQuery(
    `INSERT INTO property_access_grant (organization_id, property_id, user_id, source, created_by)
     VALUES ($1, $2, $3, 'operator', 'e2e-fixture')`,
    [input.organizationId, input.propertyId, userId],
  )
  return { userId, email: input.email, password }
}

// ── Integration fixtures ──────────────────────────────────────────────

/**
 * An ACTIVE Google connection with test-key-encrypted tokens. token_expires_at
 * is far-future so the app's refresh path (5-min buffer) never fires and the
 * OAuth token endpoint is never needed mid-test.
 */
export async function seedGoogleConnection(input: {
  organizationId: string
  connectedBy: string
  googleSubject: string
}): Promise<{ connectionId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO google_connections
       (organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, visibility, status)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour',
             ARRAY['https://www.googleapis.com/auth/business.manage'], $5, 'organization', 'active')
     RETURNING id`,
    [
      input.organizationId,
      input.googleSubject,
      encryptToken('stub-access-token'),
      encryptToken('stub-refresh-token'),
      input.connectedBy,
    ],
  )
  return { connectionId: rows[0].id }
}

// ── Property / review fixtures ────────────────────────────────────────

/**
 * Mirror of scripts/seed-e2e-user.ts's grantAccess (→ grantPropertyAccess):
 * idempotent over the ACTIVE grant, and it commits the global policy_version
 * bump in the SAME statement as the insert, so a snapshot reader can never
 * observe the grant without its version.
 */
async function grantPropertyAccessFixture(input: {
  organizationId: string
  propertyId: string
  userId: string
}): Promise<void> {
  const active = await dbQuery(
    `SELECT 1 FROM property_access_grant
     WHERE organization_id = $1 AND property_id = $2 AND user_id = $3
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [input.organizationId, input.propertyId, input.userId],
  )
  if (active.length > 0) return
  await dbQuery(
    `WITH bump AS (
       INSERT INTO policy_version (scope, version, updated_at)
       VALUES ('global', 1, now())
       ON CONFLICT (scope) DO UPDATE
         SET version = policy_version.version + 1, updated_at = now()
       RETURNING version
     ),
     ins AS (
       INSERT INTO property_access_grant
         (organization_id, property_id, user_id, source, created_by)
       VALUES ($1, $2, $3, 'operator', $3)
       RETURNING id
     )
     SELECT id FROM ins`,
    [input.organizationId, input.propertyId, input.userId],
  )
}

/**
 * Mirror of scripts/seed-e2e-user.ts's canonical property insert.
 *
 * `grantAccessToUserId` additionally writes the ACTIVE property_access_grant
 * row that is the SOLE scope source (BQC-2.2). Omit it and behaviour is
 * unchanged — property only — which is correct for callers that assert through
 * an organization-wide role. Pass it whenever the spec then asserts on
 * fleet/property CONTENT, so the assertion does not silently depend on the
 * seeded role resolving org-wide rather than assigned scope.
 */
export async function seedProperty(input: {
  organizationId: string
  name: string
  slug: string
  grantAccessToUserId?: string
  googleBinding?: Readonly<{
    connectionId: string
    accountId: string
    locationId: string
    state?: 'active' | 'disconnected'
  }>
}): Promise<{ propertyId: string }> {
  const binding = input.googleBinding
  const confirmedBy = binding
    ? (
        await dbQuery<{ connectedBy: string }>(
          `SELECT connected_by AS "connectedBy"
           FROM google_connections
           WHERE id = $1::uuid AND organization_id = $2::varchar`,
          [binding.connectionId, input.organizationId],
        )
      )[0]?.connectedBy
    : null
  if (binding && !confirmedBy) {
    throw new Error('E2E Google binding connection is unavailable')
  }
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO properties
       (organization_id, name, slug, timezone, country_code, country_source,
        processing_region, processing_region_source, routing_policy_version,
        processing_region_resolved_at, lifecycle_state, source_epoch,
        google_connection_id, gbp_account_id, gbp_location_id,
        google_binding_state, profile_source, profile_confirmed_at,
        profile_confirmed_by)
     VALUES ($1, $2, $3, 'America/New_York', 'US', 'manual',
             'us', 'country_default', 1, now(), 'active', $4,
             $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.organizationId,
      input.name,
      input.slug,
      binding ? 1 : 0,
      binding?.connectionId ?? null,
      binding?.accountId ?? null,
      binding?.locationId ?? null,
      binding ? (binding.state ?? 'active') : 'unbound',
      binding ? 'tenant_confirmed' : 'legacy',
      binding ? new Date() : null,
      confirmedBy,
    ],
  )
  const propertyId = rows[0].id
  if (input.grantAccessToUserId) {
    await grantPropertyAccessFixture({
      organizationId: input.organizationId,
      propertyId,
      userId: input.grantAccessToUserId,
    })
  }
  return { propertyId }
}

/**
 * A review row. expires_at (legal retention, NOT NULL) is set 25 days out.
 * contentExpiresAt is the eligibility clock (isContentEligibleForRead:
 * NULL is INELIGIBLE): absent → fresh (future, mirroring the sync's 30-day
 * TTL); explicit past Date → expired (typed unavailable outcome on reads);
 * explicit null → no-content (ineligible).
 */
export async function seedReview(input: {
  organizationId: string
  propertyId: string
  externalId: string
  rating: number
  text?: string | null
  reviewerName?: string | null
  languageCode?: string | null
  reviewedAt?: Date
  contentExpiresAt?: Date | null
  googleConnectionId?: string | null
  externalLocationId?: string
}): Promise<{ reviewId: string }> {
  const contentExpiresAt =
    'contentExpiresAt' in input
      ? (input.contentExpiresAt ?? null)
      : new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)
  const reviewedAt = input.reviewedAt ?? new Date()
  const reviewerName = input.reviewerName ?? null
  const languageCode = input.languageCode ?? 'en'
  const provenance = computeAiReviewSourceProvenance({
    text: input.text ?? null,
    rating: input.rating as 1 | 2 | 3 | 4 | 5,
    languageCode,
    reviewedAtEpochMillis: reviewedAt.getTime(),
    reviewerDisplayName: reviewerName,
  })
  const property = (
    await dbQuery<{ sourceEpoch: number }>(
      `SELECT source_epoch AS "sourceEpoch"
       FROM properties
       WHERE id = $1::uuid AND organization_id = $2::varchar`,
      [input.propertyId, input.organizationId],
    )
  )[0]
  if (!property) {
    throw new Error('E2E review property is unavailable')
  }
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO reviews
       (organization_id, property_id, platform, external_id, external_location_id,
        google_connection_id, reviewer_name, rating, text, language_code,
        reviewed_at, expires_at, content_expires_at,
        source_created_at, source_updated_at, first_fetched_at, last_fetched_at,
        source_epoch, source_revision, analysis_sequence,
        ai_source_byte_length, ai_source_digest)
     VALUES ($1, $2, 'google', $3, $4, $5, $6, $7, $8, $9, $10,
             now() + interval '25 days', $11, $10, $10, $10, $10,
             $12, 1, 0, $13, $14)
     RETURNING id`,
    [
      input.organizationId,
      input.propertyId,
      input.externalId,
      input.externalLocationId ?? GOOGLE_LOCATION_PRIMARY_RESOURCE,
      input.googleConnectionId ?? null,
      reviewerName,
      input.rating,
      input.text ?? null,
      languageCode,
      reviewedAt,
      contentExpiresAt,
      property.sourceEpoch,
      provenance.byteLength,
      provenance.digest,
    ],
  )
  const reviewId = rows[0].id
  // IBX-01-T9: revision 1 of the review's material identity. Observing a review
  // ALWAYS writes this row in production (review-observation.repository.ts), and
  // everything anchored to a review revision — the Handling Cycle, publication
  // authorizations, source observations, AI analyses — carries a RESTRICT
  // foreign key onto it. A review seeded without it can only ever be a bare
  // `reviews` row, so `seedInboxHandlingCycle` failed the FK outright.
  //
  // The shape is the one migration 0116 backfilled for pre-expand reviews:
  // 'legacy-unverified-v0' with no digests, which the check constraint permits
  // without recomputing the v1 normalization pipeline inside a fixture. The
  // first real observation adopts the baseline without incrementing.
  await dbQuery(
    `INSERT INTO material_review_revisions
       (review_id, revision, organization_id, property_id, source_epoch,
        normalization_version, source_digest, normalized_digest,
        rating, normalized_text, content_state, content_erased_at)
     VALUES ($1, 1, $2, $3, $4, 'legacy-unverified-v0', NULL, NULL,
             $5, $6, 'active', NULL)`,
    [
      reviewId,
      input.organizationId,
      input.propertyId,
      property.sourceEpoch,
      input.rating,
      input.text ?? null,
    ],
  )
  return { reviewId }
}

/** The content-free inbox projection row for a review (what the worker's
 * review.created handler would write — used for triage/expiry setup).
 *
 * HEADLESS ON PURPOSE: this writes `inbox_items` and nothing else, so the row
 * is invisible to every serving read. Reach for `seedReviewInboxItemWithCycle`
 * unless the test is specifically about a projection with no Handling Cycle. */
export async function seedInboxItemForReview(input: {
  organizationId: string
  propertyId: string
  reviewId: string
  sourceDate?: Date
}): Promise<{ inboxItemId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO inbox_items (organization_id, property_id, source_type, source_id, status, source_date, platform)
     VALUES ($1, $2, 'review', $3, 'open', $4, 'google')
     RETURNING id`,
    [
      input.organizationId,
      input.propertyId,
      input.reviewId,
      input.sourceDate ?? new Date(),
    ],
  )
  return { inboxItemId: rows[0].id }
}

/**
 * IBX-01-T9: the Handling Cycle authority for a seeded Inbox projection.
 *
 * Every serving read resolves status from `inbox_handling_cycle_heads`, so an
 * `inbox_items` row on its own is INVISIBLE to the product. Fixtures that seed
 * the projection directly must seed its cycle one, head, and opening transition
 * too, or the detail panel renders nothing and the failure looks like a routing
 * bug rather than a missing fixture.
 */
export async function seedInboxHandlingCycle(input: {
  organizationId: string
  propertyId: string
  inboxItemId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision?: number
  openedAt?: Date
}): Promise<void> {
  const isReview = input.sourceType === 'review'
  const sourceRevision = input.sourceRevision ?? 1
  const openedAt = input.openedAt ?? new Date()
  const openedReason = isReview ? 'review_observed' : 'feedback_submitted'
  const actorType = isReview ? 'provider' : 'guest'
  const scope = [
    input.inboxItemId,
    input.organizationId,
    input.propertyId,
    isReview ? input.sourceId : null,
    isReview ? sourceRevision : null,
    input.sourceType,
    input.sourceId,
    sourceRevision,
    openedAt,
  ]
  await dbQuery(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, review_id,
       material_review_revision, source_type, source_id, source_revision,
       opened_reason, opened_at
     ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $10, $9)`,
    [...scope, openedReason],
  )
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, review_id,
       current_cycle_number, current_material_review_revision, state_revision,
       status, source_type, source_id, current_source_revision,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, $5, 1, 'open', $6, $7, $8, $9, $9)`,
    scope,
  )
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     ) VALUES ($1, 1, 1, $2, $3, $6, $7, $8, 'opened', $10, $11, $9)`,
    [...scope, openedReason, actorType],
  )
}

/** A review Inbox projection that is actually reachable from the product. */
export async function seedReviewInboxItemWithCycle(input: {
  organizationId: string
  propertyId: string
  reviewId: string
  sourceDate?: Date
}): Promise<{ inboxItemId: string }> {
  const { inboxItemId } = await seedInboxItemForReview(input)
  await seedInboxHandlingCycle({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    inboxItemId,
    sourceType: 'review',
    sourceId: input.reviewId,
    openedAt: input.sourceDate,
  })
  return { inboxItemId }
}

/**
 * A private-feedback Inbox projection with its live Guest source. The body
 * lives in `guest_response_private_feedback` and is live-read at detail time —
 * it is never copied onto the Inbox row.
 */
export async function seedPrivateFeedbackInboxItem(input: {
  organizationId: string
  propertyId: string
  slug: string
  body: string
  rating?: number
  submittedAt?: Date
}): Promise<{ inboxItemId: string; responseId: string; portalId: string }> {
  const submittedAt = input.submittedAt ?? new Date()
  const portals = await dbQuery<{ id: string }>(
    `INSERT INTO portals (
       organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES ($1, $2, 'property', $3, 'E2E handling portal', $4, 'published')
     RETURNING id`,
    [input.organizationId, input.propertyId, input.propertyId, input.slug],
  )
  const portalId = portals[0].id
  const responses = await dbQuery<{ id: string }>(
    `INSERT INTO guest_responses (
       organization_id, property_id, portal_id, status, rating,
       response_consent, text_consent, media_consent, submitted_at,
       retention_deadline, feedback_submitted_at, feedback_submission_revision
     ) VALUES ($1, $2, $3, 'submitted', $4, true, true, false, $5,
               $5 + interval '400 days', $5, 1)
     RETURNING id`,
    [input.organizationId, input.propertyId, portalId, input.rating ?? 2, submittedAt],
  )
  const responseId = responses[0].id
  await dbQuery(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6 + interval '400 days')`,
    [
      responseId,
      input.organizationId,
      input.propertyId,
      portalId,
      input.body,
      submittedAt,
    ],
  )
  const items = await dbQuery<{ id: string }>(
    `INSERT INTO inbox_items (
       organization_id, property_id, source_type, source_id, status, source_date,
       platform
     ) VALUES ($1, $2, 'feedback', $3, 'open', $4, NULL)
     RETURNING id`,
    [input.organizationId, input.propertyId, responseId, submittedAt],
  )
  const inboxItemId = items[0].id
  await seedInboxHandlingCycle({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    inboxItemId,
    sourceType: 'feedback',
    sourceId: responseId,
    openedAt: submittedAt,
  })
  return { inboxItemId, responseId, portalId }
}

/**
 * The state a source-authoritative close leaves behind.
 *
 * Manager UI can never close Inbox work: a Google review closes when the
 * current reply is observed on Google, and private feedback closes only through
 * an explicit manager outcome or a guest withdrawal. `reply-lifecycle.spec.ts`
 * already drives the full provider pipeline end to end; this fixture supplies
 * the same terminal truth so a handling-cycle journey can start from it without
 * re-testing Review's publication machinery.
 */
export async function closeInboxItemBySourceAuthority(input: {
  organizationId: string
  inboxItemId: string
  closeReason:
    | 'confirmed_on_google'
    | 'external_reply_observed'
    | 'guest_withdrawn'
    | 'source_ineligible'
  actorType?: 'provider' | 'guest' | 'system'
  closedAt?: Date
}): Promise<void> {
  const closedAt = input.closedAt ?? new Date()
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     )
     SELECT head.inbox_item_id, head.state_revision + 1, head.current_cycle_number,
            head.organization_id, head.property_id, head.source_type,
            head.source_id, head.current_source_revision, 'closed', $4, $5, $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3
       AND head.status = 'open'`,
    [
      input.inboxItemId,
      closedAt,
      input.organizationId,
      input.closeReason,
      input.actorType ?? 'provider',
    ],
  )
  await dbQuery(
    `UPDATE inbox_handling_cycle_heads
     SET status = 'closed', state_revision = state_revision + 1, updated_at = $2
     WHERE inbox_item_id = $1 AND organization_id = $3 AND status = 'open'`,
    [input.inboxItemId, closedAt, input.organizationId],
  )
  await dbQuery(
    `UPDATE inbox_items
     SET status = 'closed', closed_at = $2, command_revision = command_revision + 1,
         updated_at = $2
     WHERE id = $1 AND organization_id = $3`,
    [input.inboxItemId, closedAt, input.organizationId],
  )
}

/**
 * The state a provider-driven reopen leaves behind: Google lost the reply, so
 * the Inbox opens a NEW numbered cycle rather than editing the closed one.
 */
export async function reopenInboxItemBySourceAuthority(input: {
  organizationId: string
  inboxItemId: string
  openedReason: 'provider_reply_deleted' | 'provider_reply_diverged'
  reopenedAt?: Date
}): Promise<void> {
  const reopenedAt = input.reopenedAt ?? new Date()
  const params = [input.inboxItemId, reopenedAt, input.organizationId, input.openedReason]
  await dbQuery(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, review_id,
       material_review_revision, source_type, source_id, source_revision,
       opened_reason, supersedes_cycle_number, opened_at
     )
     SELECT head.inbox_item_id, head.current_cycle_number + 1, head.organization_id,
            head.property_id, head.review_id, head.current_material_review_revision,
            head.source_type, head.source_id, head.current_source_revision, $4,
            head.current_cycle_number, $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3`,
    params,
  )
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     )
     SELECT head.inbox_item_id, head.state_revision + 1, head.current_cycle_number + 1,
            head.organization_id, head.property_id, head.source_type, head.source_id,
            head.current_source_revision, 'reopened', $4, 'provider', $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3`,
    params,
  )
  await dbQuery(
    `UPDATE inbox_handling_cycle_heads
     SET current_cycle_number = current_cycle_number + 1,
         state_revision = state_revision + 1, status = 'open', updated_at = $2
     WHERE inbox_item_id = $1 AND organization_id = $3`,
    [input.inboxItemId, reopenedAt, input.organizationId],
  )
  await dbQuery(
    `UPDATE inbox_items
     SET status = 'open', closed_at = NULL, command_revision = command_revision + 1,
         updated_at = $2
     WHERE id = $1 AND organization_id = $3`,
    [input.inboxItemId, reopenedAt, input.organizationId],
  )
}

/**
 * Drive a seeded private-feedback item into the terminal guest-withdrawal
 * state: the body is purged, the cycle closes with `guest_withdrawn`, and no
 * manager outcome exists or can exist. This is the shape the Inbox must render
 * without claiming anybody handled anything.
 */
export async function withdrawPrivateFeedbackInboxItem(input: {
  organizationId: string
  inboxItemId: string
  responseId: string
  withdrawnAt?: Date
}): Promise<void> {
  const withdrawnAt = input.withdrawnAt ?? new Date()
  await dbQuery('DELETE FROM guest_response_private_feedback WHERE response_id = $1', [
    input.responseId,
  ])
  await dbQuery(
    `UPDATE guest_responses SET feedback_withdrawn_at = $2, updated_at = $2
     WHERE id = $1`,
    [input.responseId, withdrawnAt],
  )
  await closeInboxItemBySourceAuthority({
    organizationId: input.organizationId,
    inboxItemId: input.inboxItemId,
    closeReason: 'guest_withdrawn',
    actorType: 'guest',
    closedAt: withdrawnAt,
  })
}

/** Remove the Guest source rows a private-feedback fixture created. */
export async function cleanupE2ePrivateFeedback(input: {
  organizationId: string
  prefix: string
}): Promise<void> {
  const like = `${input.prefix}%`
  await dbQuery(
    `DELETE FROM inbox_items WHERE organization_id = $1 AND source_type = 'feedback'
       AND source_id IN (
         SELECT response.id FROM guest_responses AS response
         JOIN portals AS portal ON portal.id = response.portal_id
         WHERE response.organization_id = $1 AND portal.slug LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery(
    `DELETE FROM guest_responses WHERE organization_id = $1 AND portal_id IN (
       SELECT id FROM portals WHERE organization_id = $1 AND slug LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery('DELETE FROM portals WHERE organization_id = $1 AND slug LIKE $2', [
    input.organizationId,
    like,
  ])
}

/** Every numbered work episode for one Inbox item, oldest first. */
export async function getInboxHandlingCycles(inboxItemId: string) {
  return dbQuery(
    `SELECT cycle_number::int AS cycle_number, opened_reason, manual_reopen_reason,
            manual_reopen_explanation, supersedes_cycle_number::int AS supersedes_cycle_number
     FROM inbox_handling_cycles WHERE inbox_item_id = $1 ORDER BY cycle_number`,
    [inboxItemId],
  )
}

/** The append-only transition log for one Inbox item, ordered by state revision. */
export async function getInboxHandlingTransitions(inboxItemId: string) {
  return dbQuery(
    `SELECT state_revision::int AS state_revision, cycle_number::int AS cycle_number,
            kind, transition_reason, actor_type, actor_user_id
     FROM inbox_handling_cycle_transitions WHERE inbox_item_id = $1
     ORDER BY state_revision`,
    [inboxItemId],
  )
}

/** The current Handling Cycle head — the status authority every read uses. */
export async function getInboxHandlingCycleHead(inboxItemId: string) {
  const rows = await dbQuery(
    `SELECT current_cycle_number::int AS current_cycle_number,
            current_source_revision::int AS current_source_revision,
            state_revision::int AS state_revision, status
     FROM inbox_handling_cycle_heads WHERE inbox_item_id = $1`,
    [inboxItemId],
  )
  return rows[0] ?? null
}

/** Manager handling outcomes for one Inbox item, oldest first. */
export async function getFeedbackHandlingOutcomes(inboxItemId: string) {
  return dbQuery(
    `SELECT cycle_number::int AS cycle_number, outcome_revision::int AS outcome_revision,
            outcome, internal_note, completion_at, deadline_result
     FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1
     ORDER BY cycle_number, outcome_revision`,
    [inboxItemId],
  )
}

/** An authorized-but-unpublished reply (status 'approved', publication_state
 * 'authorized') — the state approveReply leaves before the publish job runs. */
export async function seedApprovedReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        publication_state, publication_attempts)
     VALUES ($1, $2, $3, 'approved', 'internal', $4, now(), 'authorized', 0)
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  return { replyId: rows[0].id }
}

/** A fully published internal reply (post-publish-job state). */
export async function seedPublishedReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        published_at, publication_state, publication_attempts)
     VALUES ($1, $2, $3, 'published', 'internal', $4, now(), now(), 'published', 1)
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  return { replyId: rows[0].id }
}

/** A staff_assignments row — the notification recipient source
 * (db-user-lookup.adapter findAssignedManagers reads this table). */
export async function seedStaffAssignment(input: {
  organizationId: string
  propertyId: string
  userId: string
}): Promise<void> {
  await dbQuery(
    `INSERT INTO staff_assignments (organization_id, user_id, property_id)
     VALUES ($1, $2, $3)`,
    [input.organizationId, input.userId, input.propertyId],
  )
}

/** A reply stuck after an ambiguous publish outcome (timeout post-send on the
 * final attempt): publish_failed + publication_state 'ambiguous', reconcile due. */
export async function seedAmbiguousReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        publication_state, publication_attempts, publication_last_error_class, reconcile_due_at)
     VALUES ($1, $2, $3, 'publish_failed', 'internal', $4, now(),
             'ambiguous', 3, 'ambiguous', now() - interval '1 minute')
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  return { replyId: rows[0].id }
}

// ── DB assertion helpers ──────────────────────────────────────────────

export async function getInboxItemForReview(reviewId: string) {
  const rows = await dbQuery(
    `SELECT * FROM inbox_items WHERE source_type = 'review' AND source_id = $1`,
    [reviewId],
  )
  return rows[0] ?? null
}

export async function getInboxItemById(inboxItemId: string) {
  const rows = await dbQuery('SELECT * FROM inbox_items WHERE id = $1', [inboxItemId])
  return rows[0] ?? null
}

export async function getInboxNotes(inboxItemId: string) {
  return dbQuery(
    'SELECT * FROM inbox_notes WHERE inbox_item_id = $1 ORDER BY created_at',
    [inboxItemId],
  )
}

export async function getReplyForReview(reviewId: string) {
  const rows = await dbQuery(
    `SELECT * FROM replies WHERE review_id = $1 AND source = 'internal'`,
    [reviewId],
  )
  return rows[0] ?? null
}

export async function getReplyById(replyId: string) {
  const rows = await dbQuery('SELECT * FROM replies WHERE id = $1', [replyId])
  return rows[0] ?? null
}

export async function getReviewById(reviewId: string) {
  const rows = await dbQuery('SELECT * FROM reviews WHERE id = $1', [reviewId])
  return rows[0] ?? null
}

export async function getReviewsForProperty(propertyId: string) {
  return dbQuery(
    'SELECT * FROM reviews WHERE property_id = $1 ORDER BY reviewed_at DESC',
    [propertyId],
  )
}

export async function getConnectionById(connectionId: string) {
  const rows = await dbQuery('SELECT * FROM google_connections WHERE id = $1', [
    connectionId,
  ])
  return rows[0] ?? null
}

export async function getPropertyBySlug(organizationId: string, slug: string) {
  const rows = await dbQuery(
    'SELECT * FROM properties WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL',
    [organizationId, slug],
  )
  return rows[0] ?? null
}

export async function getPropertyByGbpLocationId(
  organizationId: string,
  gbpLocationId: string,
) {
  const rows = await dbQuery<{ id: string }>(
    'SELECT * FROM properties WHERE organization_id = $1 AND gbp_location_id = $2 AND deleted_at IS NULL',
    [organizationId, gbpLocationId],
  )
  return rows[0] ?? null
}

export async function findOutboxEvents(input: {
  eventType: string
  organizationId: string
  payloadFragment?: string
}) {
  if (input.payloadFragment !== undefined) {
    return dbQuery(
      `SELECT * FROM outbox_events
       WHERE event_type = $1 AND organization_id = $2 AND payload::text LIKE $3
       ORDER BY created_at`,
      [input.eventType, input.organizationId, `%${input.payloadFragment}%`],
    )
  }
  return dbQuery(
    'SELECT * FROM outbox_events WHERE event_type = $1 AND organization_id = $2 ORDER BY created_at',
    [input.eventType, input.organizationId],
  )
}

export async function getActivityRows(input: {
  organizationId: string
  resourceType: string
  resourceId: string
}) {
  return dbQuery(
    `SELECT * FROM activity_log
     WHERE organization_id = $1 AND resource_type = $2 AND resource_id = $3
     ORDER BY created_at`,
    [input.organizationId, input.resourceType, input.resourceId],
  )
}

export async function getNotificationsForUser(userId: string) {
  return dbQuery('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at', [
    userId,
  ])
}

// ── Cleanup (prefix-scoped, FK-safe order) ────────────────────────────

/**
 * Delete every fixture-created row matching the spec's prefix, in FK-safe
 * order. Prefixes match: reviews.external_id, google_connections.google_subject,
 * properties.slug, user.email. Call in beforeEach so reruns start clean.
 */
export async function cleanupE2eData(input: {
  organizationId: string
  prefix: string
}): Promise<void> {
  const like = `${input.prefix}%`
  // inbox notes → inbox items (for prefix-matched reviews) → replies → reviews
  await dbQuery(
    `DELETE FROM inbox_notes WHERE inbox_item_id IN (
       SELECT id FROM inbox_items WHERE organization_id = $1 AND source_id IN (
         SELECT id FROM reviews WHERE organization_id = $1 AND external_id LIKE $2))`,
    [input.organizationId, like],
  )
  await dbQuery(
    `DELETE FROM inbox_items WHERE organization_id = $1 AND source_id IN (
       SELECT id FROM reviews WHERE organization_id = $1 AND external_id LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery(
    `DELETE FROM replies WHERE organization_id = $1 AND review_id IN (
       SELECT id FROM reviews WHERE organization_id = $1 AND external_id LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery(
    'DELETE FROM reviews WHERE organization_id = $1 AND external_id LIKE $2',
    [input.organizationId, like],
  )
  // grants for prefix-matched users and properties (RESTRICT FK), then both
  await dbQuery(
    `DELETE FROM property_access_grant WHERE organization_id = $1 AND (
       user_id IN (SELECT id FROM "user" WHERE email LIKE $2) OR
       property_id IN (SELECT id FROM properties WHERE organization_id = $1 AND slug LIKE $2))`,
    [input.organizationId, like],
  )
  // staff assignments for prefix-matched users (property-linked rows cascade
  // with the property delete below; user-linked rows need this explicit pass)
  await dbQuery(
    `DELETE FROM staff_assignments WHERE organization_id = $1 AND
       user_id IN (SELECT id FROM "user" WHERE email LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery(
    'DELETE FROM notifications WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)',
    [like],
  )
  await dbQuery(
    `DELETE FROM user_organization_bindings
      WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)`,
    [like],
  )
  await dbQuery('DELETE FROM invitation WHERE email LIKE $1', [like])
  await dbQuery(
    `DELETE FROM property_operation_receipts
     WHERE organization_id = $1 AND destination_property_id IN (
       SELECT p.id
       FROM properties p
       LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
       WHERE p.organization_id = $1
         AND (p.slug LIKE $2 OR gc.google_subject LIKE $2))`,
    [input.organizationId, like],
  )
  await dbQuery(
    `DELETE FROM properties
     WHERE organization_id = $1 AND id IN (
       SELECT p.id
       FROM properties p
       LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
       WHERE p.organization_id = $1
         AND (p.slug LIKE $2 OR gc.google_subject LIKE $2))`,
    [input.organizationId, like],
  )
  await dbQuery(
    'DELETE FROM google_connections WHERE organization_id = $1 AND google_subject LIKE $2',
    [input.organizationId, like],
  )
  // Better Auth mirrors do not declare cross-track FKs in application code;
  // remove fixture memberships explicitly before the account row.
  await dbQuery(
    `DELETE FROM member
      WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
    [like],
  )
  // fixture users (account/session rows cascade from "user")
  await dbQuery('DELETE FROM "user" WHERE email LIKE $1', [like])
}

// ── BullMQ enqueues (same queue names + default prefix as the app) ────

const _queues = new Map<string, Queue>()

function fixtureQueue(name: string): Queue {
  let queue = _queues.get(name)
  if (!queue) {
    const connection = new Redis(TEST_ENV.REDIS_URL, { maxRetriesPerRequest: null })
    queue = new Queue(name, {
      connection: connection as unknown as import('bullmq').ConnectionOptions,
    })
    _queues.set(name, queue)
  }
  return queue
}

/** What review's on-property-created enqueues for the initial sync. */
export async function enqueueReviewSync(data: {
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}): Promise<void> {
  await fixtureQueue('default').add('sync-property-reviews', data, {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  })
}

/** A queued publish-reply job, optionally delayed (deterministic "queued
 * protected work" for the disconnect test — the delay guarantees the job is
 * still waiting when the disconnect lands). */
export async function enqueuePublishReply(data: {
  replyId: string
  organizationId: string
  initiatorUserId: string
  delayMs?: number
}): Promise<void> {
  await fixtureQueue('default').add(
    'publish-reply',
    {
      replyId: data.replyId,
      organizationId: data.organizationId,
      policy: { initiator: { kind: 'user', id: data.initiatorUserId } },
    },
    {
      delay: data.delayMs ?? 0,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  )
}

/** The daily retention purge, invoked on demand through the real worker path
 * (same bare payload the recurring schedule enqueues). */
export async function enqueuePurgeExpiredReviews(): Promise<void> {
  await fixtureQueue('background').add(
    'purge-expired-reviews',
    {},
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  )
}
