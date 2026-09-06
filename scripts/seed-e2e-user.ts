// Seed the deterministic local-beta acceptance landscape for Playwright.
//
// The seed intentionally uses production repositories where authorization state
// matters and direct Drizzle writes for bounded, deterministic fixture data.
// It does not boot the full composition root (which requires Redis/jobQueue).
//
// Usage:
//   DATABASE_URL=... BETTER_AUTH_SECRET=... PORTAL_TOKEN_HASH_SECRET=... \
//     pnpm exec tsx scripts/seed-e2e-user.ts

import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { E2eSeedState } from '../e2e/helpers/seed-state'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { getAuth } from '../src/shared/auth/auth'
import { getDb } from '../src/shared/db'
import { account, user, member, organization } from '../src/shared/db/schema/auth'
import {
  organizationCapability,
  propertyCapability,
} from '../src/shared/db/schema/policy.schema'
import { userOrganizationBindings } from '../src/shared/db/schema/identity-governance.schema'
import { properties } from '../src/shared/db/schema/property.schema'
import {
  portals,
  portalTokens,
  portalLinkCategories,
  portalLinks,
  portalGroupMembers,
  portalApprovedDestinations,
  portalPublicationSnapshots,
  portalPublicationActivations,
  portalHealthIntervals,
  portalResponsibleManagers,
} from '../src/shared/db/schema/portal.schema'
import { propertyResponsibleManagers } from '../src/shared/db/schema/property.schema'
import { buildPortalPublicationSnapshot } from '../src/contexts/portal/application/portal-publication-snapshot'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../src/contexts/portal/domain/approved-destination'
import { portalGroups } from '../src/shared/db/schema/portal-group.schema'
import { reviews } from '../src/shared/db/schema/review.schema'
import { computeAiReviewSourceProvenance } from '../src/contexts/review/application/ai-review-source'
import {
  staffParticipants,
  staffParticipations,
  portalResponsibilities,
  portalGroupMemberships,
} from '../src/shared/db/schema/people-access.schema'
import {
  goalDefinitions,
  goalDefinitionVersions,
  goalPeriods,
  goalEvaluations,
} from '../src/shared/db/schema/goal.schema'
import { metricReadings } from '../src/shared/db/schema/metric.schema'
import {
  notifications,
  notificationEmailQueue,
  notificationPreferences,
} from '../src/shared/db/schema/notification.schema'
import { LOCAL_BETA_CAPABILITIES } from '../src/shared/config/local-stack-contract'
import {
  grantPropertyAccess,
  hasActiveGrant,
} from '../src/contexts/identity/infrastructure/repositories/property-access-grant.repository'
import {
  addOrganizationCapability,
  addPropertyCapability,
  setOrganizationPolicy,
  setPropertyPolicy,
} from '../src/contexts/identity/infrastructure/repositories/policy-state.repository'
import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
  signUpResponseSchema,
} from '../src/contexts/identity/infrastructure/adapters/better-auth-schemas'
import { createPortalTokenCodec } from '../src/contexts/portal/infrastructure/adapters/portal-token-codec'
import { assertLocalToolExecutionIdentity } from '../src/shared/config/local-tool-execution'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '../src/shared/domain/data-cell-catalogue'
import { GOOGLE_CONTENT_CAPABILITIES } from '../src/shared/auth/google-content-contract'
import { createGoogleContentAuthorityRepository } from '../src/contexts/identity/infrastructure/repositories/google-content-authority.repository'

import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

assertLocalToolExecutionIdentity(process.env)

const managerEmail = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
const managerPassword = process.env.E2E_TEST_PASSWORD ?? 'password123'
const managerName = process.env.E2E_TEST_NAME ?? 'E2E Beta Manager'
const staffEmail = process.env.E2E_STAFF_EMAIL ?? 'staff@example.com'
const staffPassword = process.env.E2E_STAFF_PASSWORD ?? 'password123'
const staffName = process.env.E2E_STAFF_NAME ?? 'E2E Beta Staff'
const candidateAEmail = 'candidate-a@example.com'
const candidateBEmail = 'candidate-b@example.com'
const candidatePassword = 'password123'
const candidateAName = 'E2E Candidate A'
const candidateBName = 'E2E Candidate B'
const onePropertyManagerEmail = 'manager-one@example.com'
const zeroPropertyManagerEmail = 'manager-zero@example.com'
const boundedManagerPassword = 'password123'
const onePropertyManagerName = 'E2E One Property Manager'
const zeroPropertyManagerName = 'E2E Zero Property Manager'
const lockedManagerEmail = 'locked-manager@example.com'
const lockedManagerPassword = 'password123'
const lockedManagerName = 'E2E Locked Org Manager'
const organizationName = process.env.E2E_TEST_ORG ?? 'E2E Org A'

/** The one Google review destination the seeded landscape claims, in both places. */
const GOOGLE_REVIEW_DESTINATION = {
  uri: 'https://search.google.com/local/writereview?placeid=e2e-seed-place',
  retrievedAt: new Date('2026-08-01T12:00:00.000Z'),
  sourceEpoch: 0,
  profileVersion: 1,
} as const

const LOCKED_ORG_ID = 'e2e-locked-org-b'
const FIXTURE_AT = new Date('2026-08-01T12:00:00.000Z')
const GOAL_FIXTURE_AT = new Date('2026-08-08T12:00:00.000Z')
const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z')

const IDS = {
  p1: '11111111-1111-4111-8111-111111111111',
  p2: '22222222-2222-4222-8222-222222222222',
  p3: '33333333-3333-4333-8333-333333333333',
  p1Portal: '11111111-1111-4111-9111-111111111111',
  p2Portal: '22222222-2222-4222-9222-222222222222',
  p3Portal: '33333333-3333-4333-9333-333333333333',
  p1PortalToken: '11111111-1111-4111-a111-111111111111',
  p2PortalToken: '22222222-2222-4222-a222-222222222222',
  p3PortalToken: '33333333-3333-4333-a333-333333333333',
  p1Category: '11111111-1111-4111-b111-111111111111',
  p1Link: '11111111-1111-4111-8111-111111111119',
  p1LinkDestination: '11111111-1111-4111-8111-111111111154',
  p1Group: '11111111-1111-4111-8111-111111111120',
  p1GroupMember: '11111111-1111-4111-8111-111111111121',
  effectiveGroupMember: '11111111-1111-4111-8111-111111111123',
  managerParticipation: '11111111-1111-4111-8111-111111111112',
  staffParticipation: '11111111-1111-4111-8111-111111111113',
  candidateAParticipation: '11111111-1111-4111-8111-111111111126',
  candidateBParticipation: '11111111-1111-4111-8111-111111111127',
  managerParticipant: '11111111-1111-4111-8111-111111111150',
  staffParticipant: '11111111-1111-4111-8111-111111111151',
  candidateAParticipant: '11111111-1111-4111-8111-111111111152',
  candidateBParticipant: '11111111-1111-4111-8111-111111111153',
  portalResponsibility: '11111111-1111-4111-8111-111111111116',
  goal: '11111111-1111-4111-8111-111111111118',
  goalDefinitionVersion: '11111111-1111-4111-8111-111111111142',
  goalPeriod: '11111111-1111-4111-8111-111111111143',
  goalEvaluation: '11111111-1111-4111-8111-111111111144',
  notificationPreference: '11111111-1111-4111-8111-111111111125',
  notificationPreferenceInApp: '11111111-1111-4111-8111-111111111126',
  goalReading: '11111111-1111-4111-8111-111111111145',
  p1Notification: '11111111-1111-4111-8111-111111111130',
  p2Notification: '22222222-2222-4222-8222-222222222131',
  p3Notification: '33333333-3333-4333-8333-333333333132',
  p1EmailQueue: '11111111-1111-4111-8111-111111111133',
  p2EmailQueue: '22222222-2222-4222-8222-222222222134',
  p3EmailQueue: '33333333-3333-4333-8333-333333333135',
} as const

const BOUNDED_PROPERTIES = Array.from({ length: 7 }, (_, index) => ({
  id: `40000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
  name: `E2E Bounded Property ${index + 1}`,
  slug: `e2e-bounded-${index + 1}`,
}))

const seedStatePath = resolve(process.cwd(), 'e2e/.seed-state.json')

type PropertyFixture = Readonly<{ id: string; name: string; slug: string }>
type PortalFixture = Readonly<{
  id: string
  tokenId: string
  snapshotId: string
  activationId: string
  name: string
  slug: string
  tokenByte: number
}>

// Typed against the consumer's contract: a key the specs require but the seed
// forgets to emit is a compile error here, not an `undefined` read at runtime.
function writeSeedState(state: E2eSeedState) {
  mkdirSync(dirname(seedStatePath), { recursive: true })
  writeFileSync(seedStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  console.log(`E2E seed state written: ${seedStatePath}`)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

async function ensureCredentialUser(input: {
  email: string
  password: string
  name: string
}): Promise<string> {
  const auth = getAuth()
  const db = getDb()
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  let userId = existing?.id
  if (!userId) {
    const signUp = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
    })
    userId = parseBetterAuthResponse(
      signUpResponseSchema,
      signUp,
      'registration_failed',
      `Could not create E2E user ${input.email}`,
    ).user.id
  }

  await db
    .update(user)
    .set({ name: input.name, emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, userId))
  const [credential] = await db
    .update(account)
    .set({ password: await hashPassword(input.password), updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .returning({ id: account.id })
  if (!credential) throw new Error(`Credential account missing for ${input.email}`)
  return userId
}

async function resolveOrgIdForUser(userId: string): Promise<string | null> {
  const db = getDb()
  const [row] = await db
    .select({ orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .limit(1)
  return row?.orgId ?? null
}

async function ensureOrgA(managerUserId: string): Promise<string> {
  const existing = await resolveOrgIdForUser(managerUserId)
  if (existing) {
    await getDb()
      .update(organization)
      .set({ name: organizationName })
      .where(eq(organization.id, existing))
    return existing
  }
  const org = await getAuth().api.createOrganization({
    body: {
      name: organizationName,
      slug: `${slugify(organizationName)}-local-beta`,
      userId: managerUserId,
    },
  })
  return parseBetterAuthResponse(
    betterAuthOrganizationSchema,
    org,
    'org_setup_failed',
    'Invalid organization response from auth provider',
  ).id
}

async function ensureLockedOrg(): Promise<void> {
  const db = getDb()
  await db
    .insert(organization)
    .values({
      id: LOCKED_ORG_ID,
      name: 'E2E Locked Org B',
      slug: 'e2e-locked-org-b',
      createdAt: FIXTURE_AT,
    })
    .onConflictDoUpdate({
      target: organization.id,
      set: { name: 'E2E Locked Org B', slug: 'e2e-locked-org-b' },
    })
}

async function ensureMembership(input: {
  id: string
  userId: string
  organizationId: string
  role: 'owner' | 'admin' | 'member'
}): Promise<void> {
  await getDb()
    .insert(member)
    .values({ ...input, createdAt: FIXTURE_AT })
    .onConflictDoUpdate({ target: member.id, set: { role: input.role } })
}

/**
 * Give every seeded member the Organization binding the tenant resolver
 * requires.
 *
 * `c2477288 fix(identity): enforce one beta organization binding` made
 * `user_organization_bindings` a precondition for resolving tenant context:
 * with no row, `checkUserOrganizationBinding` denies with
 * `organization_binding_missing` and every authenticated request 500s. The
 * seed predates that commit and was never updated, which is why the whole
 * critical e2e suite failed on "This account needs Organization access
 * assistance" while the stack itself was healthy.
 *
 * Derived from `member` rather than written at each ensureMembership call
 * site, so a membership added later cannot silently skip its binding. The
 * table holds ONE row per user by primary key — two simultaneous active
 * bindings are deliberately unrepresentable — so a user who is a member of
 * two Organizations keeps the first binding written and the seed says so
 * rather than failing the insert.
 *
 * `source: 'backfill'` is the honest classification of the three the schema
 * permits: these memberships already exist and the binding is being
 * reconstructed for them, which is what backfill means.
 */
async function ensureOrganizationBindings(): Promise<void> {
  const db = getDb()
  const memberships = await db
    .select({ userId: member.userId, organizationId: member.organizationId })
    .from(member)
  const firstByUser = new Map<string, string>()
  for (const row of memberships) {
    if (!firstByUser.has(row.userId)) firstByUser.set(row.userId, row.organizationId)
  }
  for (const [userId, organizationId] of firstByUser) {
    await db
      .insert(userOrganizationBindings)
      .values({
        userId,
        organizationId,
        state: 'active',
        source: 'backfill',
        version: 1,
        createdAt: FIXTURE_AT,
        updatedAt: FIXTURE_AT,
      })
      .onConflictDoUpdate({
        target: userOrganizationBindings.userId,
        set: { organizationId, state: 'active', updatedAt: FIXTURE_AT },
      })
  }
}

async function ensureProperty(
  organizationId: string,
  fixture: PropertyFixture,
): Promise<string> {
  const db = getDb()
  const [existing] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, organizationId),
        eq(properties.slug, fixture.slug),
        isNull(properties.deletedAt),
      ),
    )
    .limit(1)
  const id = existing?.id ?? fixture.id
  const values = {
    organizationId,
    name: fixture.name,
    slug: fixture.slug,
    timezone: 'America/New_York',
    countryCode: 'US',
    countrySource: 'manual' as const,
    processingRegion: 'us' as const,
    dataCellId: 'us' as const,
    processingRegionSource: 'country_default' as const,
    routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    processingRegionResolvedAt: FIXTURE_AT,
    lifecycleState: 'active' as const,
    sourceEpoch: 0,
    // A verified Google review destination, matching what publishPortalSnapshot
    // stamps onto the Portal's snapshot. Without it the landscape contradicts
    // itself: the Portal is published with a verified destination while the
    // Property that owns it reports none, so the public gateway degrades and
    // publishing any new Portal is refused with "connect and refresh this
    // property's Google review destination" -- a true refusal that hides every
    // guard behind it.
    googleReviewDestinationState: 'verified' as const,
    googleReviewUri: GOOGLE_REVIEW_DESTINATION.uri,
    googleReviewDestinationRetrievedAt: GOOGLE_REVIEW_DESTINATION.retrievedAt,
    googleReviewDestinationSourceEpoch: GOOGLE_REVIEW_DESTINATION.sourceEpoch,
    googleReviewDestinationProfileVersion: GOOGLE_REVIEW_DESTINATION.profileVersion,
    updatedAt: new Date(),
  }
  if (existing) {
    await db.update(properties).set(values).where(eq(properties.id, id))
  } else {
    await db.insert(properties).values({ id, ...values })
  }
  return id
}

// Named so that ensurePortal and publishPortalSnapshot cannot drift apart: the
// publish step runs later, in a separate call, and would silently target the
// wrong snapshot id if these were restated at either site.
const P1_PORTAL_FIXTURE: PortalFixture = {
  id: IDS.p1Portal,
  tokenId: IDS.p1PortalToken,
  snapshotId: '11111111-1111-4111-a111-111111111111',
  activationId: '11111111-1111-4111-b111-111111111111',
  name: 'E2E Guest Portal P1',
  slug: 'e2e-guest-portal-p1',
  tokenByte: 0x11,
}

const P2_PORTAL_FIXTURE: PortalFixture = {
  id: IDS.p2Portal,
  tokenId: IDS.p2PortalToken,
  snapshotId: '22222222-2222-4222-a222-222222222222',
  activationId: '22222222-2222-4222-b222-222222222222',
  name: 'E2E Guest Portal P2',
  slug: 'e2e-guest-portal-p2',
  tokenByte: 0x22,
}

const P3_PORTAL_FIXTURE: PortalFixture = {
  id: IDS.p3Portal,
  tokenId: IDS.p3PortalToken,
  snapshotId: '33333333-3333-4333-a333-333333333333',
  activationId: '33333333-3333-4333-b333-333333333333',
  name: 'E2E Guest Portal P3',
  slug: 'e2e-guest-portal-p3',
  tokenByte: 0x33,
}

async function ensurePortal(
  organizationId: string,
  propertyId: string,
  fixture: PortalFixture,
): Promise<Readonly<{ portalId: string; portalToken: string }>> {
  const db = getDb()
  await db
    .insert(portals)
    .values({
      id: fixture.id,
      organizationId,
      propertyId,
      entityType: 'property',
      entityId: propertyId,
      name: fixture.name,
      slug: fixture.slug,
      description: 'Published Portal fixture for local beta acceptance.',
      theme: { primaryColor: '#6366F1' },
      publicationState: 'published',
      // Explicit, and therefore MILLISECOND precision. updated_at is the
      // Portal's optimistic-concurrency token: the editor round-trips it
      // through a JavaScript Date, which cannot represent the microseconds
      // `DEFAULT now()` stores, so a seeded Portal could never be saved -- the
      // first edit always failed with "Portal changed while the update was
      // being committed". The product's own create path sets this for the same
      // reason.
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: portals.id,
      set: {
        name: fixture.name,
        description: 'Published Portal fixture for local beta acceptance.',
        theme: { primaryColor: '#6366F1' },
        publicationState: 'published',
        deletedAt: null,
        updatedAt: new Date(),
      },
    })

  const tokenSecret = process.env.PORTAL_TOKEN_HASH_SECRET
  if (!tokenSecret) throw new Error('PORTAL_TOKEN_HASH_SECRET is required for E2E seed')
  const codec = createPortalTokenCodec({
    secret: tokenSecret,
    randomBytes: (size) => Buffer.alloc(size, fixture.tokenByte),
  })
  const token = codec.issue()
  await db.delete(portalTokens).where(eq(portalTokens.portalId, fixture.id))
  await db.insert(portalTokens).values({
    id: fixture.tokenId,
    organizationId,
    propertyId,
    portalId: fixture.id,
    tokenIdentifier: token.tokenIdentifier,
    tokenHash: token.tokenHash,
    tokenKeyVersion: token.tokenKeyVersion,
    version: 1,
    printBatch: 'local-beta-seed',
    status: 'active',
    issuedAt: FIXTURE_AT,
  })
  return { portalId: fixture.id, portalToken: token.rawToken }
}

/**
 * Give the seeded Portal the publication snapshot the public gateway requires.
 *
 * Setting `portals.publication_state = 'published'` is not what makes a Portal
 * publicly resolvable. `resolveActiveByTokenDigest` reads an ACTIVE
 * publication snapshot, so a Portal marked published with no snapshot row is a
 * state the production publish path can never produce and the app cannot
 * serve: every /p/<token> request returned portal_not_found, which is what
 * failed the five guest-portal e2e journeys.
 *
 * The snapshot is built with `buildPortalPublicationSnapshot`, the same
 * function the portal command store uses, so the configuration digest is
 * computed by the real code rather than restated here — a hand-written digest
 * would satisfy the insert and then fail `verifyPortalPublicationSnapshot`.
 *
 * A snapshot is a POINT-IN-TIME COPY, so this must run after every row it
 * copies exists. The categories and links are read back from the database
 * rather than restated, because a snapshot that omitted the seeded link would
 * serve a Portal with no destinations — the page would render and the
 * destination journeys would still fail, which is the harder bug to see.
 */
/**
 * Both guest locales, because the cross-browser gate proves the Bulgarian
 * contract renders and reflows. A snapshot published with `en` alone makes
 * `?locale=bg` fall back to English — correct product behaviour, and a
 * fixture that can never exercise the other locale.
 */
/** The stored locale set is untyped JSONB; compare it as plain sorted text. */
function sortedLocales(value: unknown): readonly string[] {
  return Array.isArray(value) ? [...value].map(String).sort() : []
}

/** Key-order-independent comparison: JSONB round-trips object keys in its own
 * order, so a plain stringify would report every seed as changed and publish a
 * new snapshot version on every run. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : entry,
  )
}

const PORTAL_LOCALE_SET = ['en', 'bg'] as const
const PORTAL_LANGUAGE_PACK_VERSIONS: Readonly<Record<string, string>> = {
  en: 'guest-ui-en-v1',
  bg: 'guest-ui-bg-v1',
}

/**
 * Whether the stored snapshot already publishes exactly what this seed would.
 *
 * The digest alone is not enough. The COLUMNS that mirror the configuration
 * are outside it, and the reader refuses a snapshot whose row and
 * configuration disagree (snapshotFromRow) — so a seed that corrected a
 * mirrored column would converge on "already serving" and never republish.
 * Snapshots are immutable, so a new version is the only way to change what is
 * served.
 */
function publishesSameConfiguration(
  existing:
    | Readonly<{
        configurationDigest: string
        localeSet: unknown
        localizedContent: unknown
        brandProfileVersion: number | null
      }>
    | undefined,
  snapshot: ReturnType<typeof buildPortalPublicationSnapshot>,
): boolean {
  if (existing?.configurationDigest !== snapshot.configurationDigest) return false
  if (
    stableJson(sortedLocales(existing.localeSet)) !==
    stableJson(sortedLocales(PORTAL_LOCALE_SET))
  ) {
    return false
  }
  const configuration = snapshot.configuration
  if (configuration.schemaVersion !== 2) return true
  return (
    existing.brandProfileVersion === configuration.brandProfile.version &&
    stableJson(existing.localizedContent ?? {}) ===
      stableJson(configuration.localizedContent)
  )
}

async function publishPortalSnapshot(input: {
  organizationId: string
  propertyId: string
  fixture: PortalFixture
}): Promise<void> {
  const db = getDb()
  const { organizationId, propertyId, fixture } = input
  const categoryRows = await db
    .select()
    .from(portalLinkCategories)
    .where(eq(portalLinkCategories.portalId, fixture.id))
  const linkRows = await db
    .select()
    .from(portalLinks)
    .where(eq(portalLinks.portalId, fixture.id))
  const snapshot = buildPortalPublicationSnapshot({
    id: fixture.snapshotId,
    portalId: fixture.id,
    organizationId,
    propertyId,
    version: 1,
    createdBy: 'local-beta-seed',
    createdAt: FIXTURE_AT,
    source: {
      portal: {
        id: fixture.id,
        name: fixture.name,
        slug: fixture.slug,
        description: 'Published Portal fixture for local beta acceptance.',
        heroImageUrl: null,
        theme: { primaryColor: '#6366F1' },
        organizationName: organizationName,
      },
      categories: categoryRows.map((row) => ({
        id: row.id,
        title: row.title,
        sortKey: row.sortKey,
      })),
      links: linkRows.map((row) => {
        // portal_links.url is nullable in the schema, but a publication
        // configuration requires an https destination. Refuse rather than drop
        // the link: a silently shorter snapshot is exactly the failure this
        // whole function exists to stop.
        if (!row.url) {
          throw new Error(`Seeded portal link ${row.id} has no url to publish`)
        }
        return {
          id: row.id,
          label: row.label,
          url: row.url,
          categoryId: row.categoryId,
          sortKey: row.sortKey,
        }
      }),
      privateFeedbackThreshold: 3,
      organizationId,
      propertyId,
      // A MULTILINGUAL publication (schema v2). Without an `experience` the
      // builder emits the legacy single-locale shape, which pins every guest
      // to English — so `?locale=bg` fell back silently and the Bulgarian
      // half of the product had no fixture that could exercise it.
      experience: {
        primaryGuestLocale: 'en',
        localeSet: [...PORTAL_LOCALE_SET],
        languagePackVersions: PORTAL_LANGUAGE_PACK_VERSIONS,
        localizedContent: {
          en: {
            title: fixture.name,
            shortDescription: 'Published Portal fixture for local beta acceptance.',
            heroImageUrl: null,
          },
          bg: {
            title: `${fixture.name} (BG)`,
            shortDescription: 'Публикуван портал за локално бета приемане.',
            heroImageUrl: null,
          },
        },
        brandProfile: {
          displayName: organizationName,
          version: 1,
          primaryColor: '#6366F1',
          backgroundColor: '#FFFFFF',
          textColor: '#111827',
          logoUrl: null,
          defaultHeroImageUrl: null,
        },
      },
    },
    destination: {
      state: 'verified',
      uri: GOOGLE_REVIEW_DESTINATION.uri,
      retrievedAt: GOOGLE_REVIEW_DESTINATION.retrievedAt,
      sourceEpoch: GOOGLE_REVIEW_DESTINATION.sourceEpoch,
      profileVersion: GOOGLE_REVIEW_DESTINATION.profileVersion,
    },
  })

  // Snapshots are append-only in both directions: a database trigger refuses
  // any UPDATE ("portal publication snapshots are immutable"), and guest
  // responses hold a foreign key to the snapshot they were served under, so a
  // DELETE fails on any stack that has been exercised. A reseed therefore
  // PUBLISHES AGAIN rather than editing in place — which is also what the
  // product does when a Portal's content changes.
  const [existing] = await db
    .select({
      id: portalPublicationSnapshots.id,
      version: portalPublicationSnapshots.version,
      configurationDigest: portalPublicationSnapshots.configurationDigest,
      localeSet: portalPublicationSnapshots.localeSet,
      localizedContent: portalPublicationSnapshots.localizedContent,
      brandProfileVersion: portalPublicationSnapshots.brandProfileVersion,
    })
    .from(portalPublicationSnapshots)
    .where(eq(portalPublicationSnapshots.portalId, fixture.id))
    .orderBy(desc(portalPublicationSnapshots.version))
    .limit(1)

  const [liveActivation] = await db
    .select({ snapshotId: portalPublicationActivations.snapshotId })
    .from(portalPublicationActivations)
    .where(
      and(
        eq(portalPublicationActivations.portalId, fixture.id),
        isNull(portalPublicationActivations.deactivatedAt),
      ),
    )
    .limit(1)

  const sameConfiguration = publishesSameConfiguration(existing, snapshot)
  const isServingCurrent =
    sameConfiguration && liveActivation?.snapshotId === existing?.id
  if (isServingCurrent) return

  // Reuse the existing snapshot when only the activation is missing — writing
  // a second identical snapshot would make the version history a lie.
  const reuseExisting = sameConfiguration
  const snapshotId = reuseExisting ? existing.id : existing ? randomUUID() : snapshot.id
  const activationId = existing ? randomUUID() : fixture.activationId
  const version = reuseExisting ? existing.version : (existing?.version ?? 0) + 1

  if (!reuseExisting) {
    await db.insert(portalPublicationSnapshots).values({
      id: snapshotId,
      organizationId: snapshot.organizationId,
      propertyId: snapshot.propertyId,
      portalId: snapshot.portalId,
      version,
      configurationDigest: snapshot.configurationDigest,
      configuration: snapshot.configuration,
      guestLocale: snapshot.configuration.guestLocale,
      languagePackVersion: snapshot.configuration.languagePackVersion,
      // These columns are the row's copy of what the CONFIGURATION publishes.
      // Leaving them out of step (an empty localizedContent beside a
      // two-locale configuration, a null brand version beside a brand
      // profile) makes the snapshot describe two different portals.
      localeSet: [...PORTAL_LOCALE_SET],
      languagePackVersions: PORTAL_LANGUAGE_PACK_VERSIONS,
      localizedContent:
        snapshot.configuration.schemaVersion === 2
          ? snapshot.configuration.localizedContent
          : {},
      brandProfileVersion:
        snapshot.configuration.schemaVersion === 2
          ? snapshot.configuration.brandProfile.version
          : null,
      privateFeedbackThreshold:
        snapshot.configuration.reviewGateway.privateFeedbackThreshold,
      destinationUri: snapshot.destinationUri,
      destinationRetrievedAt: snapshot.destinationRetrievedAt,
      destinationSourceEpoch: snapshot.destinationSourceEpoch,
      destinationProfileVersion: snapshot.destinationProfileVersion,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt,
    })
  }

  // Retire the previous activation before adding the new one: the resolver
  // takes the highest sequence among activations with no deactivated_at, so
  // leaving both live would make which snapshot is served depend on ordering.
  await db
    .update(portalPublicationActivations)
    .set({ deactivatedAt: new Date(), deactivationReason: 'replaced' })
    .where(
      and(
        eq(portalPublicationActivations.portalId, fixture.id),
        isNull(portalPublicationActivations.deactivatedAt),
      ),
    )

  await db.insert(portalPublicationActivations).values({
    id: activationId,
    organizationId,
    propertyId,
    portalId: fixture.id,
    snapshotId,
    activationSequence: version,
    kind: 'publish',
    activatedBy: 'local-beta-seed',
    activatedAt: FIXTURE_AT,
    deactivatedAt: null,
    deactivationReason: null,
  })
}

/**
 * A published, activated Portal is not yet a WORKING one: the setup
 * checklist's `published_portal` milestone requires a CURRENT healthy
 * interval. Written outside publishPortalSnapshot because that function
 * returns early when the current configuration is already being served —
 * the health fact has to converge on every seed, not only on a republish.
 */
async function ensurePortalHealthy(input: {
  organizationId: string
  propertyId: string
  portalId: string
}): Promise<void> {
  const db = getDb()
  const [current] = await db
    .select({ id: portalHealthIntervals.id })
    .from(portalHealthIntervals)
    .where(
      and(
        eq(portalHealthIntervals.portalId, input.portalId),
        isNull(portalHealthIntervals.effectiveTo),
      ),
    )
    .limit(1)
  if (current) {
    await db
      .update(portalHealthIntervals)
      .set({ status: 'healthy', reason: 'operational', observedAt: FIXTURE_AT })
      .where(eq(portalHealthIntervals.id, current.id))
    return
  }
  await db.insert(portalHealthIntervals).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    status: 'healthy',
    reason: 'operational',
    sourceVersion: FIXTURE_AT.toISOString(),
    effectiveFrom: FIXTURE_AT,
    effectiveTo: null,
    observedAt: FIXTURE_AT,
  })
}

/** The responsible-manager facts the setup checklist reads. Both scopes are
 * required: a Property manager alone leaves the Portal unowned. */
async function ensureResponsibleManagers(input: {
  organizationId: string
  propertyId: string
  portalId: string
  userId: string
}): Promise<void> {
  const db = getDb()
  await db
    .insert(propertyResponsibleManagers)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      effectiveFrom: FIXTURE_AT,
      effectiveTo: null,
      createdBy: input.userId,
    })
    .onConflictDoNothing()
  await db
    .insert(portalResponsibleManagers)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      userId: input.userId,
      effectiveFrom: FIXTURE_AT,
      effectiveTo: null,
      createdBy: input.userId,
    })
    .onConflictDoNothing()
}

async function grantAccess(
  organizationId: string,
  propertyId: string,
  userId: string,
): Promise<void> {
  const db = getDb()
  if (
    !(await hasActiveGrant(db, {
      organizationId,
      propertyId,
      userId,
      at: new Date(),
    }))
  ) {
    await grantPropertyAccess(db, {
      organizationId,
      propertyId,
      userId,
      source: 'operator',
      createdBy: userId,
    })
  }
}

async function ensurePolicyLandscape(input: {
  orgAId: string
  managerUserId: string
  p1Id: string
  offPropertyIds: readonly string[]
}): Promise<void> {
  const db = getDb()
  await setOrganizationPolicy(db, {
    organizationId: input.orgAId,
    cohort: 'beta-local',
    suspendedAt: null,
    suspendedReason: null,
  })
  await setPropertyPolicy(db, {
    propertyId: input.p1Id,
    suspendedAt: null,
    suspendedReason: null,
  })

  const orgRows = await db
    .select({ capability: organizationCapability.capability })
    .from(organizationCapability)
    .where(eq(organizationCapability.organizationId, input.orgAId))
  const propertyRows = await db
    .select({ capability: propertyCapability.capability })
    .from(propertyCapability)
    .where(eq(propertyCapability.propertyId, input.p1Id))
  const orgCapabilities = new Set(orgRows.map((row) => row.capability))
  const p1Capabilities = new Set(propertyRows.map((row) => row.capability))
  for (const capability of LOCAL_BETA_CAPABILITIES) {
    if (!orgCapabilities.has(capability)) {
      await addOrganizationCapability(db, input.orgAId, capability, input.managerUserId)
    }
    if (!p1Capabilities.has(capability)) {
      await addPropertyCapability(db, input.p1Id, capability, input.managerUserId)
    }
  }

  for (const propertyId of input.offPropertyIds) {
    await setPropertyPolicy(db, {
      propertyId,
      suspendedAt: null,
      suspendedReason: null,
    })
    await db
      .delete(propertyCapability)
      .where(eq(propertyCapability.propertyId, propertyId))
  }
  await setOrganizationPolicy(db, {
    organizationId: LOCKED_ORG_ID,
    cohort: 'locked',
    suspendedAt: null,
    suspendedReason: null,
  })
  await db
    .delete(organizationCapability)
    .where(eq(organizationCapability.organizationId, LOCKED_ORG_ID))
}

async function ensurePortalFixtures(
  organizationId: string,
  propertyId: string,
  managerUserId: string,
) {
  const db = getDb()
  await db
    .insert(portalLinkCategories)
    .values({
      id: IDS.p1Category,
      portalId: IDS.p1Portal,
      organizationId,
      title: 'Share your experience',
      sortKey: 'a0',
    })
    .onConflictDoUpdate({
      target: portalLinkCategories.id,
      set: { title: 'Share your experience', sortKey: 'a0' },
    })
  await db
    .insert(portalLinks)
    .values({
      id: IDS.p1Link,
      categoryId: IDS.p1Category,
      portalId: IDS.p1Portal,
      organizationId,
      propertyId,
      label: 'Visit example review destination',
      url: 'https://example.com/reviews',
      iconKey: 'external-link',
      sortKey: 'a0',
    })
    .onConflictDoUpdate({
      target: portalLinks.id,
      set: {
        label: 'Visit example review destination',
        propertyId,
        url: 'https://example.com/reviews',
        sortKey: 'a0',
      },
    })
  // A published link is not a served link. `resolveApprovedLinks` filters the
  // snapshot's links down to destinations that are approved AND were validated
  // within the last 30 minutes, so a seeded link with no approval row is
  // silently dropped and the Portal renders with no destinations.
  //
  // lastValidatedAt is deliberately `new Date()` and not FIXTURE_AT: freshness
  // is relative to now, and a fixture instant is always stale. In production
  // the revalidation job keeps this moving; here the seed is the only writer,
  // so a stack left idle for over 30 minutes needs a reseed before the
  // destination journeys will pass.
  await db
    .insert(portalApprovedDestinations)
    .values({
      id: IDS.p1LinkDestination,
      organizationId,
      propertyId,
      normalizedUri: 'https://example.com/reviews',
      hostname: 'example.com',
      sourceType: 'custom',
      approvalState: 'approved',
      validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
      requestedBy: managerUserId,
      approvedBy: managerUserId,
      approvedAt: FIXTURE_AT,
      lastValidatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: portalApprovedDestinations.id,
      set: {
        approvalState: 'approved',
        disabledAt: null,
        disabledReason: null,
        lastValidatedAt: new Date(),
      },
    })

  await db
    .insert(portalGroups)
    .values({
      id: IDS.p1Group,
      organizationId,
      propertyId,
      name: 'E2E Guest Services',
      sortKey: 'a0',
    })
    .onConflictDoUpdate({
      target: portalGroups.id,
      set: { name: 'E2E Guest Services', deletedAt: null },
    })
  await db
    .insert(portalGroupMembers)
    .values({
      id: IDS.p1GroupMember,
      portalGroupId: IDS.p1Group,
      portalId: IDS.p1Portal,
      organizationId,
    })
    .onConflictDoUpdate({
      target: portalGroupMembers.id,
      set: { portalGroupId: IDS.p1Group, portalId: IDS.p1Portal },
    })
  await db
    .insert(portalGroupMemberships)
    .values({
      id: IDS.effectiveGroupMember,
      organizationId,
      propertyId,
      portalId: IDS.p1Portal,
      portalGroupId: IDS.p1Group,
      effectiveFrom: FIXTURE_AT,
      createdBy: managerUserId,
    })
    .onConflictDoNothing()
}

async function ensurePeopleFixtures(input: {
  organizationId: string
  propertyId: string
  managerUserId: string
  staffUserId: string
  candidateAUserId: string
  candidateBUserId: string
}): Promise<void> {
  const db = getDb()

  // A participation with no participant is corruption, not an empty state.
  // `decidePrimaryStaffAttribution` fails closed when the participant join
  // yields nothing, so seeding participations alone made every guest response
  // submit throw PrimaryStaffAttributionCorruptionError — a 500, not a 404.
  await db
    .insert(staffParticipants)
    .values(
      [
        { id: IDS.managerParticipant, displayName: managerName },
        { id: IDS.staffParticipant, displayName: staffName },
        { id: IDS.candidateAParticipant, displayName: candidateAName },
        { id: IDS.candidateBParticipant, displayName: candidateBName },
      ].map((participant) => ({
        ...participant,
        organizationId: input.organizationId,
        status: 'active' as const,
        createdBy: input.managerUserId,
        createdAt: FIXTURE_AT,
      })),
    )
    .onConflictDoNothing()

  await db
    .insert(staffParticipations)
    .values([
      {
        id: IDS.managerParticipation,
        staffParticipantId: IDS.managerParticipant,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.managerUserId,
        displayName: managerName,
        status: 'active',
        startedAt: FIXTURE_AT,
        createdBy: input.managerUserId,
      },
      {
        id: IDS.staffParticipation,
        staffParticipantId: IDS.staffParticipant,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.staffUserId,
        displayName: staffName,
        status: 'active',
        startedAt: FIXTURE_AT,
        createdBy: input.managerUserId,
      },
      {
        id: IDS.candidateAParticipation,
        staffParticipantId: IDS.candidateAParticipant,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.candidateAUserId,
        displayName: candidateAName,
        status: 'active',
        startedAt: FIXTURE_AT,
        createdBy: input.managerUserId,
      },
      {
        id: IDS.candidateBParticipation,
        staffParticipantId: IDS.candidateBParticipant,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.candidateBUserId,
        displayName: candidateBName,
        status: 'active',
        startedAt: FIXTURE_AT,
        createdBy: input.managerUserId,
      },
    ])
    // Converge rather than skip: a stack seeded before participants existed
    // keeps its unlinked participation rows forever under DoNothing, and the
    // attribution guard would go on failing closed against stale data.
    .onConflictDoUpdate({
      target: staffParticipations.id,
      set: {
        staffParticipantId: sql`excluded.staff_participant_id`,
        status: sql`excluded.status`,
        startedAt: sql`excluded.started_at`,
        endedAt: null,
      },
    })
  await db
    .insert(portalResponsibilities)
    .values({
      id: IDS.portalResponsibility,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: IDS.p1Portal,
      staffParticipationId: IDS.staffParticipation,
      kind: 'primary',
      effectiveFrom: FIXTURE_AT,
      createdBy: input.managerUserId,
    })
    .onConflictDoNothing()
}

async function ensureGoalFixtures(input: {
  organizationId: string
  propertyId: string
  managerUserId: string
}): Promise<void> {
  const db = getDb()
  await db
    .insert(metricReadings)
    .values({
      id: IDS.goalReading,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      groupId: IDS.p1Group,
      metricKey: 'portal.content_review.completed',
      value: 8,
      definitionVersionId: '11111111-1111-4111-8111-111111111101',
      sourceEventId: 'e2e-goal-content-reviewed-1',
      sourcePolicy: 'first_party_workflow',
      exactValue: 8,
      sampleCount: 8,
      attributionQuality: 'exact',
      occurredAt: GOAL_FIXTURE_AT,
      eventAt: GOAL_FIXTURE_AT,
      propertyLocalDate: '2026-08-08',
      dataQuality: 'accepted',
      retentionClass: 'standard',
    })
    .onConflictDoUpdate({
      target: metricReadings.id,
      set: {
        exactValue: 8,
        value: 8,
        sampleCount: 8,
        eventAt: GOAL_FIXTURE_AT,
      },
    })
  await db
    .insert(goalDefinitions)
    .values({
      id: IDS.goal,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      scopeKind: 'portal_group',
      portalGroupId: IDS.p1Group,
      name: 'Complete 20 portal content reviews',
      description: 'Stable governed group Goal for local beta acceptance.',
      status: 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: input.managerUserId,
    })
    .onConflictDoUpdate({
      target: goalDefinitions.id,
      set: {
        status: 'active',
        statusReason: null,
        currentVersion: 1,
        updatedAt: new Date(),
      },
    })
  await db
    .insert(goalDefinitionVersions)
    .values({
      id: IDS.goalDefinitionVersion,
      definitionId: IDS.goal,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      version: 1,
      metricDefinitionId: '11111111-1111-4111-8111-111111110101',
      metricDefinitionVersionId: '11111111-1111-4111-8111-111111111101',
      metricKey: 'portal.content_review.completed',
      metricValueKind: 'counter',
      metricMinimumSample: 1,
      metricAllowedScopes: ['property', 'portal_group'],
      metricPermittedConsumers: ['dashboard', 'goal', 'notification'],
      metricEmploymentDecisionEligible: false,
      measureKind: 'progress',
      targetValue: 20,
      sourcePolicy: 'first_party_workflow',
      propertyTimezone: 'America/New_York',
      recurrenceRule: { frequency: 'monthly', interval: 1 },
      effectiveFrom: new Date('2026-08-01T04:00:00.000Z'),
      effectiveTo: null,
      changeReason: 'seeded',
      createdBy: input.managerUserId,
    })
    .onConflictDoNothing()
  await db
    .insert(goalPeriods)
    .values({
      id: IDS.goalPeriod,
      definitionId: IDS.goal,
      definitionVersionId: IDS.goalDefinitionVersion,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      periodStart: new Date('2026-08-01T04:00:00.000Z'),
      periodEnd: new Date('2026-09-01T04:00:00.000Z'),
      propertyTimezone: 'America/New_York',
      status: 'open',
      statusReason: null,
      evaluationWatermark: GOAL_FIXTURE_AT,
      closedAt: null,
    })
    .onConflictDoUpdate({
      target: goalPeriods.id,
      set: {
        status: 'open',
        statusReason: null,
        evaluationWatermark: GOAL_FIXTURE_AT,
        closedAt: null,
        updatedAt: new Date(),
      },
    })
  await db
    .insert(goalEvaluations)
    .values({
      id: IDS.goalEvaluation,
      periodId: IDS.goalPeriod,
      definitionId: IDS.goal,
      definitionVersionId: IDS.goalDefinitionVersion,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      metricReadingId: IDS.goalReading,
      sourceEventId: 'e2e-goal-content-reviewed-1',
      idempotencyKey: 'e2e-goal-evaluation-v1',
      state: 'eligible',
      reason: 'governed_reading',
      value: 8,
      numerator: null,
      denominator: null,
      sampleCount: 8,
      achieved: false,
      evaluationWatermark: GOAL_FIXTURE_AT,
      supersedesEvaluationId: null,
      correctionReadingId: null,
      createdBy: 'system:e2e-seed',
    })
    .onConflictDoNothing()
  await db
    .insert(notificationPreferences)
    .values([
      {
        id: IDS.notificationPreference,
        userId: input.managerUserId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        cadence: 'daily',
      },
      {
        id: IDS.notificationPreferenceInApp,
        userId: input.managerUserId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        category: 'workflow_collaboration',
        channel: 'in_app',
        enabled: true,
        cadence: 'immediate',
      },
    ])
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.organizationId,
        notificationPreferences.propertyId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: { enabled: true, updatedAt: new Date() },
    })
}

async function ensureReviews(input: {
  orgAId: string
  p1Id: string
  p2Id: string
  p3Id: string
  boundedIds: readonly string[]
}): Promise<void> {
  const db = getDb()
  // Keep the seeded review windows stable as wall-clock time advances: the
  // newest fixture is always 15 days old, so the 30-day fleet view contains
  // 30 P1 reviews and 15 P2 reviews.
  const reviewedAtAnchor = new Date()
  reviewedAtAnchor.setUTCHours(12, 0, 0, 0)
  reviewedAtAnchor.setUTCDate(reviewedAtAnchor.getUTCDate() - 15)
  const propertyFor = (index: number) => {
    if (index < 40) return { organizationId: input.orgAId, propertyId: input.p1Id }
    if (index < 60) return { organizationId: input.orgAId, propertyId: input.p2Id }
    if (index < 80) return { organizationId: LOCKED_ORG_ID, propertyId: input.p3Id }
    return {
      organizationId: input.orgAId,
      propertyId: input.boundedIds[(index - 80) % input.boundedIds.length]!,
    }
  }

  for (let index = 0; index < 100; index += 1) {
    const ordinal = index + 1
    const scope = propertyFor(index)
    const id = `50000000-0000-4000-8000-${ordinal.toString(16).padStart(12, '0')}`
    const reviewedAt = new Date(reviewedAtAnchor)
    reviewedAt.setUTCDate(reviewedAt.getUTCDate() - (index % 20))
    const text = `Deterministic local beta review ${ordinal}.`
    const reviewerName = `E2E Reviewer ${ordinal}`
    const provenance = computeAiReviewSourceProvenance({
      text,
      rating: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
      languageCode: 'en',
      reviewedAtEpochMillis: reviewedAt.getTime(),
      reviewerDisplayName: reviewerName,
    })
    await db
      .insert(reviews)
      .values({
        id,
        ...scope,
        platform: 'google',
        externalId: `e2e-beta-review-${ordinal.toString().padStart(3, '0')}`,
        externalLocationId: `e2e-location-${scope.propertyId}`,
        reviewerName,
        rating: (index % 5) + 1,
        text,
        languageCode: 'en',
        reviewedAt,
        expiresAt: FAR_FUTURE,
        contentExpiresAt: FAR_FUTURE,
        sourceCreatedAt: reviewedAt,
        sourceUpdatedAt: reviewedAt,
        firstFetchedAt: reviewedAt,
        lastFetchedAt: reviewedAt,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 0,
        aiSourceByteLength: provenance.byteLength,
        aiSourceDigest: provenance.digest,
      })
      .onConflictDoUpdate({
        target: reviews.id,
        set: {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          rating: (index % 5) + 1,
          reviewedAt,
          aiSourceByteLength: provenance.byteLength,
          aiSourceDigest: provenance.digest,
          expiresAt: FAR_FUTURE,
          contentExpiresAt: FAR_FUTURE,
        },
      })
    const metricReadingId = `51000000-0000-4000-8000-${ordinal
      .toString(16)
      .padStart(12, '0')}`
    await db
      .insert(metricReadings)
      .values({
        id: metricReadingId,
        ...scope,
        metricKey: 'property.review',
        value: (index % 5) + 1,
        definitionVersionId: '11111111-1111-4111-8111-111111111205',
        sourceEventId: `e2e-review-created-${ordinal}`,
        sourcePolicy: 'google_property_derivative',
        exactValue: (index % 5) + 1,
        sampleCount: 1,
        attributionQuality: 'exact',
        occurredAt: reviewedAt,
        eventAt: reviewedAt,
        propertyLocalDate: reviewedAt.toISOString().slice(0, 10),
        dataQuality: 'exact',
        retentionClass: 'standard',
      })
      .onConflictDoUpdate({
        target: metricReadings.id,
        set: {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          value: (index % 5) + 1,
          exactValue: (index % 5) + 1,
          occurredAt: reviewedAt,
          eventAt: reviewedAt,
          propertyLocalDate: reviewedAt.toISOString().slice(0, 10),
          dataQuality: 'exact',
        },
      })
  }
}
async function ensureDueEmailFixture(input: {
  notificationId: string
  emailQueueId: string
  organizationId: string
  propertyId: string
  userId: string
  label: string
}): Promise<void> {
  const db = getDb()
  await db
    .insert(notifications)
    .values({
      id: input.notificationId,
      userId: input.userId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      type: 'review.created',
      category: 'workflow_collaboration',
      priority: 'normal',
      status: 'unread',
      resourceType: 'inbox_item',
      resourceId: `e2e-${input.label}-inbox-item`,
      eventId: `e2e-${input.label}-email-event`,
      title: `${input.label} due email fixture`,
      body: null,
      createdAt: FIXTURE_AT,
    })
    .onConflictDoUpdate({
      target: notifications.id,
      set: { status: 'unread', updatedAt: FIXTURE_AT },
    })
  await db
    .insert(notificationEmailQueue)
    .values({
      id: input.emailQueueId,
      notificationId: input.notificationId,
      userId: input.userId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      category: 'workflow_collaboration',
      cadence: 'daily',
      status: 'pending',
      priority: 'normal',
      idempotencyKey: `e2e-${input.label}-daily-email`,
      notBefore: FIXTURE_AT,
      nextAttemptAt: FIXTURE_AT,
      retryCount: 0,
      createdAt: FIXTURE_AT,
    })
    .onConflictDoUpdate({
      target: notificationEmailQueue.id,
      set: {
        status: 'pending',
        providerMessageId: null,
        providerState: null,
        lastErrorClass: null,
        suppressionReason: null,
        notBefore: FIXTURE_AT,
        nextAttemptAt: FIXTURE_AT,
        attemptedAt: null,
        acceptedAt: null,
        deliveredAt: null,
        bouncedAt: null,
        sentAt: null,
        failedAt: null,
        retryCount: 0,
        updatedAt: FIXTURE_AT,
      },
    })
}

async function ensureLocalGoogleContentCapabilitiesAllowed(): Promise<void> {
  const store = createGoogleContentAuthorityRepository(getDb())
  const control = await store.transaction((tx) => store.loadControl(tx))
  const changedAt = new Date()
  for (const capability of GOOGLE_CONTENT_CAPABILITIES) {
    if (!control.killedCapabilities.includes(capability)) continue
    await store.transaction((tx) =>
      store.allowCapability(tx, capability, {
        operatorId: 'local-stack-seed',
        reason: 'local acceptance',
        changedAt,
      }),
    )
  }
}

async function main(): Promise<void> {
  await ensureLocalGoogleContentCapabilitiesAllowed()
  const managerUserId = await ensureCredentialUser({
    email: managerEmail,
    password: managerPassword,
    name: managerName,
  })
  const staffUserId = await ensureCredentialUser({
    email: staffEmail,
    password: staffPassword,
    name: staffName,
  })
  const candidateAUserId = await ensureCredentialUser({
    email: candidateAEmail,
    password: candidatePassword,
    name: candidateAName,
  })
  const candidateBUserId = await ensureCredentialUser({
    email: candidateBEmail,
    password: candidatePassword,
    name: candidateBName,
  })
  const onePropertyManagerUserId = await ensureCredentialUser({
    email: onePropertyManagerEmail,
    password: boundedManagerPassword,
    name: onePropertyManagerName,
  })
  const zeroPropertyManagerUserId = await ensureCredentialUser({
    email: zeroPropertyManagerEmail,
    password: boundedManagerPassword,
    name: zeroPropertyManagerName,
  })
  const lockedManagerUserId = await ensureCredentialUser({
    email: lockedManagerEmail,
    password: lockedManagerPassword,
    name: lockedManagerName,
  })
  const orgAId = await ensureOrgA(managerUserId)
  await ensureLockedOrg()
  await ensureMembership({
    id: 'e2e-org-a-staff-member',
    userId: staffUserId,
    organizationId: orgAId,
    role: 'member',
  })
  await ensureMembership({
    id: 'e2e-org-a-candidate-a-member',
    userId: candidateAUserId,
    organizationId: orgAId,
    role: 'member',
  })
  await ensureMembership({
    id: 'e2e-org-a-candidate-b-member',
    userId: candidateBUserId,
    organizationId: orgAId,
    role: 'member',
  })
  await ensureMembership({
    id: 'e2e-org-a-one-property-manager',
    userId: onePropertyManagerUserId,
    organizationId: orgAId,
    role: 'admin',
  })
  await ensureMembership({
    id: 'e2e-org-a-zero-property-manager',
    userId: zeroPropertyManagerUserId,
    organizationId: orgAId,
    role: 'admin',
  })

  await ensureMembership({
    id: 'e2e-org-b-locked-manager',
    userId: lockedManagerUserId,
    organizationId: LOCKED_ORG_ID,
    role: 'owner',
  })
  // Bindings AFTER every membership exists, so the derivation sees them all.
  await ensureOrganizationBindings()

  const p1Id = await ensureProperty(orgAId, {
    id: IDS.p1,
    name: 'E2E Beta Hotel P1',
    slug: 'e2e-beta-p1',
  })
  const p2Id = await ensureProperty(orgAId, {
    id: IDS.p2,
    name: 'E2E Beta Hotel P2',
    slug: 'e2e-beta-p2',
  })
  const p3Id = await ensureProperty(LOCKED_ORG_ID, {
    id: IDS.p3,
    name: 'E2E Locked Hotel P3',
    slug: 'e2e-locked-p3',
  })
  const boundedIds = await Promise.all(
    BOUNDED_PROPERTIES.map((fixture) => ensureProperty(orgAId, fixture)),
  )

  for (const propertyId of [p1Id, p2Id, ...boundedIds]) {
    await grantAccess(orgAId, propertyId, managerUserId)
  }
  await grantAccess(LOCKED_ORG_ID, p3Id, lockedManagerUserId)
  await grantAccess(orgAId, p1Id, staffUserId)
  await grantAccess(orgAId, p1Id, candidateAUserId)
  await grantAccess(orgAId, p1Id, candidateBUserId)
  await grantAccess(orgAId, p1Id, onePropertyManagerUserId)
  await ensurePolicyLandscape({
    orgAId,
    managerUserId,
    p1Id,
    offPropertyIds: [p2Id, p3Id, ...boundedIds],
  })

  const p1Portal = await ensurePortal(orgAId, p1Id, P1_PORTAL_FIXTURE)
  const p2Portal = await ensurePortal(orgAId, p2Id, P2_PORTAL_FIXTURE)
  const p3Portal = await ensurePortal(LOCKED_ORG_ID, p3Id, P3_PORTAL_FIXTURE)

  await ensurePortalFixtures(orgAId, p1Id, managerUserId)

  // Publish only once the links and categories the snapshot copies are in
  // place — see publishPortalSnapshot for why the order is load-bearing.
  await publishPortalSnapshot({
    organizationId: orgAId,
    propertyId: p1Id,
    fixture: P1_PORTAL_FIXTURE,
  })
  await publishPortalSnapshot({
    organizationId: orgAId,
    propertyId: p2Id,
    fixture: P2_PORTAL_FIXTURE,
  })
  await publishPortalSnapshot({
    organizationId: LOCKED_ORG_ID,
    propertyId: p3Id,
    fixture: P3_PORTAL_FIXTURE,
  })
  // P1 is the "set up and working" Property the dashboard journeys assert
  // against, so its setup checklist must be COMPLETE by seed, not by luck.
  await ensurePortalHealthy({
    organizationId: orgAId,
    propertyId: p1Id,
    portalId: P1_PORTAL_FIXTURE.id,
  })
  await ensureResponsibleManagers({
    organizationId: orgAId,
    propertyId: p1Id,
    portalId: P1_PORTAL_FIXTURE.id,
    userId: managerUserId,
  })
  await ensurePeopleFixtures({
    organizationId: orgAId,
    propertyId: p1Id,
    managerUserId,
    staffUserId,
    candidateAUserId,
    candidateBUserId,
  })
  await ensureGoalFixtures({
    organizationId: orgAId,
    propertyId: p1Id,
    managerUserId,
  })
  await ensureReviews({ orgAId, p1Id, p2Id, p3Id, boundedIds })

  await ensureDueEmailFixture({
    notificationId: IDS.p1Notification,
    emailQueueId: IDS.p1EmailQueue,
    organizationId: orgAId,
    propertyId: p1Id,
    userId: managerUserId,
    label: 'p1',
  })
  await ensureDueEmailFixture({
    notificationId: IDS.p2Notification,
    emailQueueId: IDS.p2EmailQueue,
    organizationId: orgAId,
    propertyId: p2Id,
    userId: managerUserId,
    label: 'p2',
  })
  await ensureDueEmailFixture({
    notificationId: IDS.p3Notification,
    emailQueueId: IDS.p3EmailQueue,
    organizationId: LOCKED_ORG_ID,
    propertyId: p3Id,
    userId: lockedManagerUserId,
    label: 'p3',
  })
  writeSeedState({
    version: 'beta-local-1',
    email: managerEmail,
    password: managerPassword,
    staffEmail,
    staffPassword,
    managerName,
    staffName,
    candidateAName,
    candidateBName,
    candidateAParticipationId: IDS.candidateAParticipation,
    candidateBParticipationId: IDS.candidateBParticipation,
    organizationId: orgAId,
    managerUserId,
    organizationName,
    lockedOrganizationId: LOCKED_ORG_ID,
    lockedManagerEmail,
    lockedManagerPassword,
    propertyId: p1Id,
    propertyName: 'E2E Beta Hotel P1',
    onePropertyManagerEmail,
    zeroPropertyManagerEmail,
    boundedManagerPassword,
    propertySlug: 'e2e-beta-p1',
    p1PropertyId: p1Id,
    p2PropertyId: p2Id,
    p3PropertyId: p3Id,
    boundedPropertyIds: boundedIds,
    portalId: p1Portal.portalId,
    portalToken: p1Portal.portalToken,
    p2PortalId: p2Portal.portalId,
    p2PortalToken: p2Portal.portalToken,
    p3PortalId: p3Portal.portalId,
    p3PortalToken: p3Portal.portalToken,
    portalGroupId: IDS.p1Group,
    portalLinkId: IDS.p1Link,
    managerParticipationId: IDS.managerParticipation,
    staffParticipationId: IDS.staffParticipation,
    goalId: IDS.goal,
    emailQueueFixtureIds: [IDS.p1EmailQueue, IDS.p2EmailQueue, IDS.p3EmailQueue],
    reviewCount: 100,
  })
  const clearedLimits = await clearGuestRateLimitCounters()
  console.log(
    `E2E beta-local-1 landscape ready: P1 on, P2/P3 off, 7 bounded rows, 100 reviews, ${clearedLimits} rate-limit counters cleared`,
  )
}

/**
 * Reset the guest rate-limit counters so a run starts from a known budget.
 *
 * The guest submit budget is 5 per network+Portal PER HOUR, and every spec in
 * the suite shares one network and one Portal. The counters live in Redis, so
 * they outlive the database reseed: a second run inside the hour started
 * part-spent and failed with "Your rating could not be saved", which reads like
 * a product defect rather than exhausted budget.
 *
 * This resets the counter, not the rule — within a run the budget still binds,
 * which is what the abuse cases actually test.
 */
async function clearGuestRateLimitCounters(): Promise<number> {
  const url = process.env.REDIS_URL
  if (!url) return 0
  const redis = new Redis(url, { maxRetriesPerRequest: 2 })
  try {
    let cleared = 0
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'ratelimit:*', 'COUNT', 500)
      cursor = next
      if (keys.length > 0) cleared += await redis.del(...keys)
    } while (cursor !== '0')
    return cleared
  } finally {
    redis.disconnect()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-e2e-user failed:', err)
    process.exit(1)
  })
