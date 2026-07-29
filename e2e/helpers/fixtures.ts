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

import { Pool } from 'pg'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import type { Page } from '@playwright/test'
import { testEnvironment } from '../../src/shared/testing/test-environment'

/** Unique-per-run marker for every fixture-created external identifier. */
export const e2eRunId = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

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

export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: { timeoutMs: number; intervalMs?: number; description: string },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs
  const interval = options.intervalMs ?? 250
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(
    `waitFor timed out after ${options.timeoutMs}ms: ${options.description}` +
      (lastError ? ` (last error: ${String(lastError)})` : ''),
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
 * Dev server-fn id (the Playwright webServer runs `pnpm dev`): base64url of
 * JSON { file: '/<repo-relative>?tss-serverfn-split', export: '<name>_createServerFn_handler' }.
 */
export function serverFnUrl(file: string, exportName: string): string {
  const id = Buffer.from(
    JSON.stringify({
      file: `/${file}?tss-serverfn-split`,
      export: `${exportName}_createServerFn_handler`,
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

/** POST a server fn; throws when the fn returned a serialized error. */
export async function callServerFn<T = unknown>(
  page: Page,
  fn: { file: string; exportName: string; data: unknown },
): Promise<T> {
  const body = JSON.stringify(await (await codec()).toJSONAsync({ data: fn.data }))
  const res = await page.request.post(serverFnUrl(fn.file, fn.exportName), {
    headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    data: body,
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
  const res = await page.request.post(serverFnUrl(fn.file, fn.exportName), {
    headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    data: body,
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
  const res = await page.request.get(url, {
    headers: { 'x-tsr-serverFn': 'true' },
  })
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
  const res = await page.request.get(url, {
    headers: { 'x-tsr-serverFn': 'true' },
  })
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
 * An ACTIVE google connection with test-key-encrypted tokens. token_expires_at
 * is far-future so the app's refresh path (5-min buffer) never fires and the
 * OAuth token endpoint is never needed mid-test.
 */
export async function seedGoogleConnection(input: {
  organizationId: string
  connectedBy: string
  googleAccountId: string
  googleEmail?: string
}): Promise<{ connectionId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO google_connections
       (organization_id, google_account_id, google_email, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, visibility, status)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour',
             ARRAY['https://www.googleapis.com/auth/business.manage'], $6, 'organization', 'active')
     RETURNING id`,
    [
      input.organizationId,
      input.googleAccountId,
      input.googleEmail ?? `${input.googleAccountId}@e2e.example.com`,
      encryptToken('stub-access-token'),
      encryptToken('stub-refresh-token'),
      input.connectedBy,
    ],
  )
  return { connectionId: rows[0].id }
}

// ── Property / review fixtures ────────────────────────────────────────

/** Mirror of scripts/seed-e2e-user.ts's canonical property insert. */
export async function seedProperty(input: {
  organizationId: string
  name: string
  slug: string
  gbpPlaceId?: string
  googleConnectionId?: string
}): Promise<{ propertyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO properties
       (organization_id, name, slug, timezone, country_code, country_source,
        processing_region, processing_region_source, routing_policy_version,
        processing_region_resolved_at, lifecycle_state, source_epoch,
        gbp_place_id, google_connection_id)
     VALUES ($1, $2, $3, 'America/New_York', 'US', 'manual',
             'us', 'country_default', 1, now(), 'active', 0, $4, $5)
     RETURNING id`,
    [
      input.organizationId,
      input.name,
      input.slug,
      input.gbpPlaceId ?? null,
      input.googleConnectionId ?? null,
    ],
  )
  return { propertyId: rows[0].id }
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
  reviewedAt?: Date
  contentExpiresAt?: Date | null
  googleConnectionId?: string | null
  externalLocationId?: string
}): Promise<{ reviewId: string }> {
  const contentExpiresAt =
    'contentExpiresAt' in input
      ? (input.contentExpiresAt ?? null)
      : new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO reviews
       (organization_id, property_id, platform, external_id, external_location_id,
        google_connection_id, reviewer_name, rating, text, reviewed_at, expires_at,
        content_expires_at)
     VALUES ($1, $2, 'google', $3, $4, $5, $6, $7, $8, $9,
             now() + interval '25 days', $10)
     RETURNING id`,
    [
      input.organizationId,
      input.propertyId,
      input.externalId,
      input.externalLocationId ?? 'accounts/e2e-fixture/locations/e2e-fixture',
      input.googleConnectionId ?? null,
      input.reviewerName ?? null,
      input.rating,
      input.text ?? null,
      input.reviewedAt ?? new Date(),
      contentExpiresAt,
    ],
  )
  return { reviewId: rows[0].id }
}

/** The content-free inbox projection row for a review (what the worker's
 * review.created handler would write — used for triage/expiry setup). */
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

export async function getPropertyByGbpPlaceId(
  organizationId: string,
  gbpPlaceId: string,
) {
  const rows = await dbQuery(
    'SELECT * FROM properties WHERE organization_id = $1 AND gbp_place_id = $2 AND deleted_at IS NULL',
    [organizationId, gbpPlaceId],
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
 * order. Prefixes match: reviews.external_id, google_connections.google_account_id,
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
  await dbQuery('DELETE FROM properties WHERE organization_id = $1 AND slug LIKE $2', [
    input.organizationId,
    like,
  ])
  await dbQuery(
    'DELETE FROM google_connections WHERE organization_id = $1 AND google_account_id LIKE $2',
    [input.organizationId, like],
  )
  // staff users (account/member cascade from "user")
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
