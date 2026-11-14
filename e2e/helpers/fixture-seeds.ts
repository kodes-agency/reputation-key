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
//
// What stays SQL, and why. A journey creates what it can through the product's
// own commands: invitations through `inviteMember`, a Property's reply language
// through `updateProperty`, an imported Property through the import commands
// (failure-recovery), Portals through the Portal commands. The helpers below
// stay raw SQL because no command reaches the state they build:
//   seedGoogleConnection      the tokens come from a Google OAuth consent screen
//                             that no test can drive; the row itself is written by
//                             the connection builder in src/shared/testing, which
//                             the integration suites use too
//   seedProperty              a Property bound to a Google location and a
//                             connection the journey already owns, under a
//                             run-scoped location id. The import commands list
//                             an account's locations and make their own
//                             Properties; only failure-recovery and
//                             google-import-sync go that way, because they
//                             prove the import itself
//   seedMemberUserWithGrant   an account made by accepting an invitation gets a
//                             Better Auth id, which the assignment commands'
//                             uuid check refuses; the helper makes the uuid id
//                             and the grant those commands need
//   seedReview, seedPrivateFeedbackInboxItem, seedInboxHandlingCycle and the
//   inbox/reply seeds         reviews arrive from the provider sync and from
//                             guests; these build states the sync cannot reach on
//                             demand (an ambiguous send, a lapsed content expiry,
//                             a review already in a closed cycle)
//   close/reopen/withdraw...  the source-authority transitions run on events no
//                             browser fires
//   get*, find*, wait*        read-only assertions

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '../../test-fixtures/generated/google-provider-identifiers-v1'
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { computeAiReviewSourceProvenance } from '../../src/contexts/review/application/ai-review-source'
import { seedGoogleConnection as seedSharedGoogleConnection } from '../../src/shared/testing/google-connection-seed'
import { dbQuery, encryptToken } from './fixture-db'

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
 * A Member: Better Auth user (credential account) + member row + an ACTIVE
 * property_access_grant with source 'operator' (the operator-allowlist
 * provenance). The user id is a UUID so the user is a valid assignment target
 * (assignInboxItemFn validates assignedToUserId as uuid — Better Auth's own
 * nanoid ids fail it; see the slice report).
 *
 * `role` defaults to 'member' (→ Member permissions): a login that is
 * deliberately NOT beta-interactive, so it cannot sign in. Only the parked
 * reply-redaction case of dashboard-governance.spec.ts still asks for it.
 *
 * A spec that needs a property-scoped login that works passes 'admin' (a
 * grant-only PropertyManager): property-access.spec.ts, the scoped test of
 * dashboard-governance.spec.ts and the Inbox specs do. 'owner' is an AccountAdmin.
 * Assignment authorizes the ASSIGNEE as its own principal, and Member is not a
 * beta-interactive role, so handing an Inbox item to a Member user is refused
 * with "Inbox command authority is no longer current" before any permission or
 * grant is read. A PropertyManager needs only this grant: Staff Participation
 * and login links are attribution facts and gate nothing (ADR 0052, amended
 * 2026-09-30), so no Staff rows are seeded here.
 */
export async function seedMemberUserWithGrant(input: {
  organizationId: string
  propertyId: string
  email: string
  name?: string
  password?: string
  role?: 'owner' | 'admin' | 'member'
}): Promise<{ userId: string; email: string; password: string }> {
  const userId = randomUUID()
  const password = input.password ?? 'MemberPass123!'
  const passwordHash = await hashPassword(password)

  await dbQuery(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())',
    [userId, input.name ?? 'E2E Member', input.email],
  )
  await dbQuery(
    'INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, now(), now())',
    [`e2e-${randomUUID()}`, userId, 'credential', userId, passwordHash],
  )
  await dbQuery(
    'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())',
    [`e2e-${randomUUID()}`, input.organizationId, userId, input.role ?? 'member'],
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
  // `google_subject` is globally unique, and a connection outlives cleanup
  // whenever a Property still binds it — so scenarios that share an account
  // must ADOPT the surviving connection rather than collide with it.
  return seedSharedGoogleConnection(
    { query: async (text, values) => ({ rows: await dbQuery(text, values) }) },
    {
      organizationId: input.organizationId,
      connectedBy: input.connectedBy,
      googleSubject: input.googleSubject,
      accessToken: encryptToken('stub-access-token'),
      refreshToken: encryptToken('stub-refresh-token'),
      adoptExistingSubject: true,
    },
  )
}

// ── Property / review fixtures ────────────────────────────────────────

/** Idempotent mirror of the surviving PropertyAccessGrant authority. */
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
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by)
     VALUES ($1, $2, $3, 'operator', $3)`,
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
        lifecycle_state, source_epoch,
        google_connection_id, gbp_account_id, gbp_location_id,
        google_binding_state, profile_source, profile_confirmed_at,
        profile_confirmed_by)
     VALUES ($1, $2, $3, 'America/New_York', 'US', 'manual',
             'active', $4,
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
 * A stable review identity with a separately stored provider-content row.
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
       (organization_id, property_id, platform, google_connection_id, first_fetched_at,
        source_epoch, source_revision, analysis_sequence,
        material_normalization_version)
     VALUES ($1, $2, 'google', $3, $4, $5, 1, 0, 'legacy-unverified-v0')
     RETURNING id`,
    [
      input.organizationId,
      input.propertyId,
      input.googleConnectionId ?? null,
      reviewedAt,
      property.sourceEpoch,
    ],
  )
  const reviewId = rows[0].id
  // The provider-content row the readers serve from. Without a content clock the
  // review holds nothing to serve, so it has none. It cascades with the review.
  if (contentExpiresAt !== null) {
    await dbQuery(
      `INSERT INTO review_source_contents (
         review_id, organization_id, property_id, platform, external_id,
         external_location_id, google_connection_id, reviewer_name, rating, text,
         language_code, reviewed_at, source_created_at, source_updated_at,
         first_fetched_at, last_fetched_at, content_expires_at,
         source_epoch, source_revision, ai_source_byte_length, ai_source_digest
       )
       VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $9, $10,
               $11, $11, $11, $11, $11, $12, $13, 1, $14, $15)`,
      [
        reviewId,
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
  }
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
  //
  // The baseline lives in TWO places and both must agree: production compares
  // against the material columns on `reviews`, not this table. Seeding the row
  // here while leaving `reviews.material_normalization_version` NULL made an
  // observation read "no previous material", derive revision 1, and collide
  // with the row below — failing the whole provider snapshot run.
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

/**
 * Force a credential account's password back to a known value.
 *
 * The security journey changes the seeded manager's password and changes it
 * back. When it failed midway the account kept the CHANGED password, and
 * every later spec in the suite died at sign-in — one broken test poisoned
 * the whole run and only a reseed recovered it. This restore runs from the
 * test's `finally`, so it cannot be skipped by a failure earlier in the body.
 */
export async function forceUserPassword(email: string, password: string): Promise<void> {
  const hash = await hashPassword(password)
  await dbQuery(
    `UPDATE account SET password = $1, "updatedAt" = now()
     WHERE "providerId" = 'credential'
       AND "userId" = (SELECT id FROM "user" WHERE email = $2)`,
    [hash, email],
  )
}

/** The content-free inbox projection row for a review (what the worker's
 * review.created handler would write — used for triage/expiry setup).
 *
 * HEADLESS ON PURPOSE: this writes `inbox_items` and nothing else, so the row
 * is invisible to every serving read. Reach for `seedReviewInboxItemWithCycle`
 * unless the test is specifically about a projection with no Handling Cycle. */
