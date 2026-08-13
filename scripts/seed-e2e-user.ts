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
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { getAuth } from '../src/shared/auth/auth'
import { getDb } from '../src/shared/db'
import { account, user, member, organization } from '../src/shared/db/schema/auth'
import {
  organizationCapability,
  propertyCapability,
} from '../src/shared/db/schema/policy.schema'
import { properties } from '../src/shared/db/schema/property.schema'
import {
  portals,
  portalTokens,
  portalLinkCategories,
  portalLinks,
  portalGroupMembers,
} from '../src/shared/db/schema/portal.schema'
import { portalGroups } from '../src/shared/db/schema/portal-group.schema'
import { reviews } from '../src/shared/db/schema/review.schema'
import { teams } from '../src/shared/db/schema/team.schema'
import {
  staffParticipations,
  teamMemberships,
  portalResponsibilities,
  teamPortalGroupScopes,
  portalGroupMemberships,
} from '../src/shared/db/schema/people-access.schema'
import {
  goalDefinitions,
  goalDefinitionVersions,
  goalPeriods,
  goalEvaluations,
} from '../src/shared/db/schema/goal.schema'
import { metricReadings } from '../src/shared/db/schema/metric.schema'
import { governedBadgeAwards } from '../src/shared/db/schema/badge.schema'
import {
  recognitionActivations,
  recognitionActivationGroups,
  recognitionBoardSnapshots,
  recognitionBoardEntries,
} from '../src/shared/db/schema/leaderboard.schema'
import {
  notifications,
  notificationEmailQueue,
  notificationPreferences,
} from '../src/shared/db/schema/notification.schema'
import { LOCAL_BETA_CAPABILITIES } from '../src/shared/config/local-stack-contract'
import { CAPABILITY_POLICY_VERSION } from '../src/shared/auth/beta-capabilities'
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

const LOCKED_ORG_ID = 'e2e-locked-org-b'
const FIXTURE_AT = new Date('2026-08-01T12:00:00.000Z')
const GOAL_FIXTURE_AT = new Date('2026-08-08T12:00:00.000Z')
const GOVERNED_FIXTURE_AT = new Date('2026-08-09T00:01:00.000Z')
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
  p1Group: '11111111-1111-4111-8111-111111111120',
  p1GroupMember: '11111111-1111-4111-8111-111111111121',
  effectiveGroupMember: '11111111-1111-4111-8111-111111111123',
  p1Team: '11111111-1111-4111-8111-111111111124',
  managerParticipation: '11111111-1111-4111-8111-111111111112',
  staffParticipation: '11111111-1111-4111-8111-111111111113',
  managerMembership: '11111111-1111-4111-8111-111111111114',
  candidateAParticipation: '11111111-1111-4111-8111-111111111126',
  candidateBParticipation: '11111111-1111-4111-8111-111111111127',
  staffMembership: '11111111-1111-4111-8111-111111111115',
  portalResponsibility: '11111111-1111-4111-8111-111111111116',
  teamGroupScope: '11111111-1111-4111-8111-111111111117',
  goal: '11111111-1111-4111-8111-111111111118',
  goalDefinitionVersion: '11111111-1111-4111-8111-111111111142',
  goalPeriod: '11111111-1111-4111-8111-111111111143',
  goalEvaluation: '11111111-1111-4111-8111-111111111144',
  badge: '44444444-4444-4444-8444-444444444101',
  badgeAward: '11111111-1111-4111-8111-111111111122',
  notificationPreference: '11111111-1111-4111-8111-111111111125',
  notificationPreferenceInApp: '11111111-1111-4111-8111-111111111126',
  recognitionActivation: '11111111-1111-4111-8111-111111111128',
  recognitionReading: '11111111-1111-4111-8111-111111111129',
  goalReading: '11111111-1111-4111-8111-111111111145',
  recognitionActivationGroup: '11111111-1111-4111-8111-111111111127',
  recognitionBoardSnapshot: '11111111-1111-4111-8111-111111111140',
  recognitionBoardEntry: '11111111-1111-4111-8111-111111111141',
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
  name: string
  slug: string
  tokenByte: number
}>

function writeSeedState(state: Record<string, unknown>) {
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
    processingRegionSource: 'country_default' as const,
    routingPolicyVersion: 1,
    processingRegionResolvedAt: FIXTURE_AT,
    lifecycleState: 'active' as const,
    sourceEpoch: 0,
    updatedAt: new Date(),
  }
  if (existing) {
    await db.update(properties).set(values).where(eq(properties.id, id))
  } else {
    await db.insert(properties).values({ id, ...values })
  }
  return id
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
      label: 'Visit example review destination',
      url: 'https://example.com/reviews',
      iconKey: 'external-link',
      sortKey: 'a0',
    })
    .onConflictDoUpdate({
      target: portalLinks.id,
      set: {
        label: 'Visit example review destination',
        url: 'https://example.com/reviews',
        sortKey: 'a0',
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

async function ensurePeopleAndTeamFixtures(input: {
  organizationId: string
  propertyId: string
  managerUserId: string
  staffUserId: string
  candidateAUserId: string
  candidateBUserId: string
}): Promise<void> {
  const db = getDb()
  await db
    .insert(staffParticipations)
    .values([
      {
        id: IDS.managerParticipation,
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
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.candidateBUserId,
        displayName: candidateBName,
        status: 'active',
        startedAt: FIXTURE_AT,
        createdBy: input.managerUserId,
      },
    ])
    .onConflictDoNothing()
  await db
    .insert(teams)
    .values({
      id: IDS.p1Team,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      name: 'E2E Guest Services Team',
      description: 'Stable team fixture for lead and membership journeys.',
      teamLeadId: input.managerUserId,
    })
    .onConflictDoUpdate({
      target: teams.id,
      set: {
        name: 'E2E Guest Services Team',
        description: 'Stable team fixture for lead and membership journeys.',
        deletedAt: null,
      },
    })
  await db
    .delete(teamMemberships)
    .where(
      inArray(teamMemberships.staffParticipationId, [
        IDS.managerParticipation,
        IDS.staffParticipation,
        IDS.candidateAParticipation,
        IDS.candidateBParticipation,
      ]),
    )
  await db.insert(teamMemberships).values([
    {
      id: IDS.managerMembership,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      teamId: IDS.p1Team,
      staffParticipationId: IDS.managerParticipation,
      role: 'lead',
      effectiveFrom: FIXTURE_AT,
      createdBy: input.managerUserId,
    },
    {
      id: IDS.staffMembership,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      teamId: IDS.p1Team,
      staffParticipationId: IDS.staffParticipation,
      role: 'member',
      effectiveFrom: FIXTURE_AT,
      createdBy: input.managerUserId,
    },
  ])
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
  await db
    .insert(teamPortalGroupScopes)
    .values({
      id: IDS.teamGroupScope,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      teamId: IDS.p1Team,
      portalGroupId: IDS.p1Group,
      effectiveFrom: FIXTURE_AT,
      createdBy: input.managerUserId,
    })
    .onConflictDoNothing()
}

async function ensureGoalAndRecognitionFixtures(input: {
  organizationId: string
  propertyId: string
  managerUserId: string
}): Promise<void> {
  const db = getDb()
  await db
    .insert(metricReadings)
    .values({
      id: IDS.recognitionReading,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      groupId: IDS.p1Group,
      metricKey: 'portal.content_review.completed',
      value: 8,
      definitionVersionId: '11111111-1111-4111-8111-111111112101',
      sourceEventId: 'e2e-recognition-content-reviewed-1',
      sourcePolicy: 'first_party_workflow',
      exactValue: '8',
      sampleCount: 8,
      attributionQuality: 'exact',
      occurredAt: GOVERNED_FIXTURE_AT,
      eventAt: GOVERNED_FIXTURE_AT,
      propertyLocalDate: '2026-08-08',
      dataQuality: 'accepted',
      retentionClass: 'standard',
    })
    .onConflictDoUpdate({
      target: metricReadings.id,
      set: {
        exactValue: '8',
        value: 8,
        sampleCount: 8,
        eventAt: GOVERNED_FIXTURE_AT,
      },
    })
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
      exactValue: '8',
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
        exactValue: '8',
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
      metricPermittedConsumers: [
        'dashboard',
        'goal',
        'badge',
        'leaderboard',
        'notification',
      ],
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
    .insert(recognitionActivations)
    .values({
      id: IDS.recognitionActivation,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
      jurisdiction: 'local-e2e',
      noticeStatus: 'completed',
      consultationStatus: 'not_required',
      metricDefinitionVersionId: '11111111-1111-4111-8111-111111112101',
      aggregation: 'sum',
      periodKind: 'monthly',
      minimumExposure: 1,
      minimumSample: 1,
      freshnessSeconds: 2_678_400,
      minimumCompleteness: 0.9,
      audience: 'property_managers_and_scoped_staff',
      acknowledgedBy: input.managerUserId,
      acknowledgedAt: GOVERNED_FIXTURE_AT,
      effectiveFrom: GOVERNED_FIXTURE_AT,
      effectiveTo: null,
      status: 'active',
      employmentDecisionEligible: false,
    })
    .onConflictDoUpdate({
      target: recognitionActivations.id,
      set: {
        capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
        metricDefinitionVersionId: '11111111-1111-4111-8111-111111112101',
        aggregation: 'sum',
        periodKind: 'monthly',
        minimumExposure: 1,
        minimumSample: 1,
        freshnessSeconds: 2_678_400,
        minimumCompleteness: 0.9,
        status: 'active',
        effectiveTo: null,
        employmentDecisionEligible: false,
      },
    })
  await db
    .insert(recognitionActivationGroups)
    .values({
      id: IDS.recognitionActivationGroup,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      activationId: IDS.recognitionActivation,
      portalGroupId: IDS.p1Group,
    })
    .onConflictDoNothing()
  await db
    .insert(recognitionBoardSnapshots)
    .values({
      id: IDS.recognitionBoardSnapshot,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      activationId: IDS.recognitionActivation,
      metricDefinitionId: '11111111-1111-4111-8111-111111110101',
      metricDefinitionVersionId: '11111111-1111-4111-8111-111111112101',
      aggregation: 'sum',
      periodKind: 'monthly',
      periodStart: new Date('2026-08-01T04:00:00.000Z'),
      periodEnd: new Date('2026-09-01T04:00:00.000Z'),
      timezone: 'America/New_York',
      minimumExposure: 1,
      minimumSample: 1,
      freshnessSeconds: 2_678_400,
      minimumCompleteness: 0.9,
      sourceWatermark: GOVERNED_FIXTURE_AT,
      status: 'ready',
      correctionGeneration: 0,
      employmentDecisionEligible: false,
      reconciledAt: GOVERNED_FIXTURE_AT,
    })
    .onConflictDoNothing()
  await db
    .insert(recognitionBoardEntries)
    .values({
      id: IDS.recognitionBoardEntry,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      snapshotId: IDS.recognitionBoardSnapshot,
      portalGroupId: IDS.p1Group,
      value: 8,
      numerator: null,
      denominator: null,
      sampleCount: 8,
      exposureCount: 8,
      completeness: 1,
      rank: 1,
      tieGroup: 1,
      eligibilityReason: 'eligible',
      status: 'ranked',
      sourceWatermark: GOVERNED_FIXTURE_AT,
      correctionGeneration: 0,
      employmentDecisionEligible: false,
      reconciledAt: GOVERNED_FIXTURE_AT,
    })
    .onConflictDoNothing()
  await db
    .insert(governedBadgeAwards)
    .values({
      id: IDS.badgeAward,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalGroupId: IDS.p1Group,
      definitionVersionId: '55555555-5555-4555-8555-555555555101',
      metricDefinitionVersionId: '11111111-1111-4111-8111-111111112101',
      sourceSnapshotId: IDS.recognitionBoardSnapshot,
      sourceFactId: `${IDS.recognitionBoardSnapshot}:55555555-5555-4555-8555-555555555101:${IDS.p1Group}`,
      sourceWatermark: GOVERNED_FIXTURE_AT,
      periodStart: new Date('2026-08-01T04:00:00.000Z'),
      periodEnd: new Date('2026-09-01T04:00:00.000Z'),
      timezone: 'America/New_York',
      sampleCount: 8,
      exposureCount: 8,
      completeness: 1,
      eligibilityReason: 'eligible',
      definitionSnapshot: {
        name: 'Content Review Stewardship',
        icon: 'clipboard-check',
        criteria: 'At least five governed content reviews in the period',
        rule: 'sum >= 5',
        metricVersion: '11111111-1111-4111-8111-111111112101',
      },
      awardedAt: GOVERNED_FIXTURE_AT,
      employmentDecisionEligible: false,
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
    const reviewedAt = new Date(Date.UTC(2026, 6, 31 - (index % 20), 12, 0, 0))
    await db
      .insert(reviews)
      .values({
        id,
        ...scope,
        platform: 'google',
        externalId: `e2e-beta-review-${ordinal.toString().padStart(3, '0')}`,
        externalLocationId: `e2e-location-${scope.propertyId}`,
        reviewerName: `E2E Reviewer ${ordinal}`,
        rating: (index % 5) + 1,
        text: `Deterministic local beta review ${ordinal}.`,
        languageCode: 'en',
        reviewedAt,
        expiresAt: FAR_FUTURE,
        contentExpiresAt: FAR_FUTURE,
        sourceCreatedAt: reviewedAt,
        sourceUpdatedAt: reviewedAt,
        firstFetchedAt: reviewedAt,
        lastFetchedAt: reviewedAt,
      })
      .onConflictDoUpdate({
        target: reviews.id,
        set: {
          organizationId: scope.organizationId,
          propertyId: scope.propertyId,
          rating: (index % 5) + 1,
          reviewedAt,
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
        exactValue: String((index % 5) + 1),
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
          exactValue: String((index % 5) + 1),
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

async function main(): Promise<void> {
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

  const p1Portal = await ensurePortal(orgAId, p1Id, {
    id: IDS.p1Portal,
    tokenId: IDS.p1PortalToken,
    name: 'E2E Guest Portal P1',
    slug: 'e2e-guest-portal-p1',
    tokenByte: 0x11,
  })
  const p2Portal = await ensurePortal(orgAId, p2Id, {
    id: IDS.p2Portal,
    tokenId: IDS.p2PortalToken,
    name: 'E2E Guest Portal P2',
    slug: 'e2e-guest-portal-p2',
    tokenByte: 0x22,
  })
  const p3Portal = await ensurePortal(LOCKED_ORG_ID, p3Id, {
    id: IDS.p3Portal,
    tokenId: IDS.p3PortalToken,
    name: 'E2E Guest Portal P3',
    slug: 'e2e-guest-portal-p3',
    tokenByte: 0x33,
  })

  await ensurePortalFixtures(orgAId, p1Id, managerUserId)
  await ensurePeopleAndTeamFixtures({
    organizationId: orgAId,
    propertyId: p1Id,
    managerUserId,
    staffUserId,
    candidateAUserId,
    candidateBUserId,
  })
  await ensureGoalAndRecognitionFixtures({
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
    teamId: IDS.p1Team,
    managerParticipationId: IDS.managerParticipation,
    staffParticipationId: IDS.staffParticipation,
    goalId: IDS.goal,
    badgeDefinitionId: IDS.badge,
    emailQueueFixtureIds: [IDS.p1EmailQueue, IDS.p2EmailQueue, IDS.p3EmailQueue],
    reviewCount: 100,
  })
  console.log(
    'E2E beta-local-1 landscape ready: P1 on, P2/P3 off, 7 bounded rows, 100 reviews',
  )
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-e2e-user failed:', err)
    process.exit(1)
  })
