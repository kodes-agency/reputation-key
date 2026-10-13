// A Portal Responsible Manager assigned in the gap of their own offboarding,
// against real PostgreSQL.
//
// Removing a member releases their responsibilities first and deletes the
// membership afterwards, in separate commits. In between the member is still
// eligible, so an assignment another admin saves there is accepted, and the
// release that ran before it cannot see it. Portal Health then counts the
// Portal as staffed by someone who is gone.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { identityMemberRemoved } from '#/contexts/identity/domain/events'
import { capabilityForSystemAction } from '#/shared/auth/system-execution-policy'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  releaseRemovedMemberResponsibilities,
  type ResponsibleManagerMembership,
} from '#/shared/responsible-manager-eligibility'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { policyDeps } from '../application/portal-manager-eligibility'
import { updatePortalResponsibleManagers } from '../application/use-cases/portal-responsible-managers'
import { registerPortalMemberOffboardingConsumers } from './member-offboarding-outbox-consumers'
import { createPortalRepository } from './repositories/portal.repository'
import { createPortalResponsibleManagerRepository } from './repositories/portal-responsible-manager.repository'
import { createPostgresPortalFixtureStore } from './testing/postgres-portal-fixture-store'

const ORG = 'org-portal-offboarding-gap'
const PROPERTY = 'fb100000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'fb100000-0000-4000-8000-000000000002'
const PORTAL = 'fb200000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_PORTAL = 'fb200000-0000-4000-8000-000000000002'
const ADMIN = 'admin-portal-offboarding-gap'
const DEPARTING = 'departing-portal-offboarding-gap'
const CREATED = new Date('2026-10-01T09:00:00.000Z')
const ASSIGNED_AT = new Date('2026-10-13T09:00:00.000Z')
const REMOVED_AT = new Date('2026-10-13T09:00:01.000Z')
const DELIVERED_AT = new Date('2026-10-13T09:00:05.000Z')
const COMMITTED_AT = new Date('2026-10-13T09:00:06.000Z')

const db = getDb()
const outbox = createOutboxRepository(db)
const managers = createPortalResponsibleManagerRepository(db)
let pool: Pool
/** Identity's current managers of the Organization, and the Properties a PropertyManager may reach. */
let members: readonly ResponsibleManagerMembership[] = []
let accessibleProperties: readonly string[] = []
/**
 * Runs once, after Identity's next answer was read and before its caller goes
 * on: how a removal is made to commit between an assignment's eligibility read
 * and its own commit.
 */
let afterNextManagerRead: (() => Promise<void>) | null = null

/** Identity's facts as the Portal context reads them. */
const identityFacts = {
  identityPublicApi: {
    listActiveManagers: async () => {
      const read = members
      const interleaved = afterNextManagerRead
      afterNextManagerRead = null
      await interleaved?.()
      return read
    },
  },
  staffPublicApi: {
    getAccessiblePropertyIds: async () => accessibleProperties.map(propertyId),
    getAssignedPortals: async () => [],
  },
}

/** The save another admin makes, as the Portal context builds it. */
const saveManagers = updatePortalResponsibleManagers({
  ...identityFacts,
  portalRepo: createPortalRepository(db),
  managerRepo: managers,
  clock: () => COMMITTED_AT,
})

const accountAdmin = (id: string): ResponsibleManagerMembership => ({
  userId: id,
  role: 'AccountAdmin',
  propertyAccessScope: 'organization',
})

/** The store write `updatePortalResponsibleManagers` makes once it found the member eligible. */
async function assignInTheGap(portal: string, property: string): Promise<void> {
  await managers.replace({
    organizationId: ORG,
    propertyId: property,
    portalId: portal,
    managerUserIds: [DEPARTING],
    expectedRevision: 1,
    actorId: ADMIN,
    at: ASSIGNED_AT,
  })
}

/** The membership delete commits, with the fact every removal path records. */
async function removeMembership(): Promise<ConsumerEvent> {
  members = members.filter((member) => member.userId !== DEPARTING)
  const fact = identityMemberRemoved({
    organizationId: organizationId(ORG),
    userId: userId(DEPARTING),
    removedBy: userId(ADMIN),
    occurredAt: REMOVED_AT,
  })
  const row = toOutboxEvent(fact)
  await outbox.insert({ ...row, id: fact.eventId })
  return {
    eventId: fact.eventId,
    eventType: fact._tag,
    eventVersion: 1,
    organizationId: ORG,
    propertyId: null,
    sourceContext: 'identity',
    sourceAggregateId: row.sourceAggregateId,
    occurredAt: REMOVED_AT.toISOString(),
    payload: row.payload,
  }
}

/** The Portal consumer registered for the fact, as its worker wires it. */
function removalConsumer() {
  const registry = createConsumerRegistry()
  registerPortalMemberOffboardingConsumers(registry, {
    // Bound as buildPortalContext binds it.
    release: releaseRemovedMemberResponsibilities({
      eligibility: policyDeps(identityFacts),
      listHeld: managers.listActiveForUser,
      releaseHeld: (release, lost) =>
        managers.releaseForUser({
          ...release,
          portalIds: lost.map((assignment) => assignment.portalId),
        }),
      clock: () => DELIVERED_AT,
    }),
    receipts: outbox,
  })
  const registrations = registry.listFor('identity.member.removed')
  expect(registrations).toHaveLength(1)
  return registrations[0]!
}

const assignments = async () =>
  (
    await pool.query<{
      portal_id: string
      effective_to: Date | null
      end_reason: string | null
    }>(
      `SELECT portal_id, effective_to, end_reason FROM portal_responsible_managers
       WHERE organization_id = $1 AND user_id = $2 ORDER BY portal_id`,
      [ORG, DEPARTING],
    )
  ).rows

const neededSince = async (portal: string) =>
  (
    await pool.query<{ responsibility_needed_since: Date | null }>(
      'SELECT responsibility_needed_since FROM portals WHERE id = $1',
      [portal],
    )
  ).rows[0]?.responsibility_needed_since

const gapFacts = async () =>
  (
    await pool.query<{ portal_id: string; actor: string | null }>(
      `SELECT payload->>'portalId' AS portal_id, payload->>'actorUserId' AS actor
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'portal.responsibility_became_needed'
       ORDER BY payload->>'portalId'`,
      [ORG],
    )
  ).rows

const receipts = async (eventId: string) =>
  (
    await pool.query<{ consumer_name: string; status: string }>(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [eventId],
    )
  ).rows

async function clean(): Promise<void> {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portal_responsible_managers WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await clean()
  await pool.end()
  clearEventSchemas()
})

beforeEach(async () => {
  await clean()
  afterNextManagerRead = null
  members = [accountAdmin(ADMIN), accountAdmin(DEPARTING)]
  accessibleProperties = []
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW())`,
    [ORG],
  )
  const fixtures = createPostgresPortalFixtureStore(db)
  for (const [property, portal, slug] of [
    [PROPERTY, PORTAL, 'offboarding-gap'],
    [OTHER_PROPERTY, OTHER_PROPERTY_PORTAL, 'offboarding-gap-other'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Offboarding Gap', $3, 'UTC', NOW(), NOW())`,
      [property, ORG, slug],
    )
    await fixtures.insert(
      organizationId(ORG),
      buildTestPortal({
        id: portal,
        organizationId: organizationId(ORG),
        propertyId: propertyId(property),
        entityId: propertyId(property),
        slug,
        publicationState: 'published',
        createdBy: userId(ADMIN),
        responsibilityNeededSince: CREATED,
        createdAt: CREATED,
        updatedAt: CREATED,
      }),
    )
  }
})

describe.sequential('Portal responsibility across a member removal (PostgreSQL)', () => {
  it('releases a manager who was assigned after their offboarding released them', async () => {
    await assignInTheGap(PORTAL, PROPERTY)
    expect(await neededSince(PORTAL)).toBeNull()
    const removed = await removeMembership()

    await expect(removalConsumer().handler(removed)).resolves.toEqual({
      status: 'applied',
    })

    // No longer the Portal's manager, and the gap is recorded and announced:
    // the admin who removed them is the one who opened it.
    expect(await assignments()).toEqual([
      {
        portal_id: PORTAL,
        effective_to: DELIVERED_AT,
        end_reason: 'manager_offboarded',
      },
    ])
    expect(await neededSince(PORTAL)).toEqual(DELIVERED_AT)
    expect(await gapFacts()).toEqual([{ portal_id: PORTAL, actor: ADMIN }])
    expect(await receipts(removed.eventId)).toEqual([
      { consumer_name: 'portal.on-member-removed', status: 'applied' },
    ])
  })

  it('releases nothing twice when the fact is delivered again', async () => {
    await assignInTheGap(PORTAL, PROPERTY)
    const removed = await removeMembership()
    const consumer = removalConsumer()

    await consumer.handler(removed)
    await expect(consumer.handler(removed)).resolves.toEqual({ status: 'applied' })

    expect(await assignments()).toHaveLength(1)
    expect(await gapFacts()).toHaveLength(1)
  })

  it('keeps what a member who is back may still hold, Property by Property', async () => {
    await assignInTheGap(PORTAL, PROPERTY)
    await assignInTheGap(OTHER_PROPERTY_PORTAL, OTHER_PROPERTY)
    const removed = await removeMembership()
    // Invited again as a PropertyManager of one Property before the worker
    // reached the fact.
    members = [
      ...members,
      {
        userId: DEPARTING,
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
    ]
    accessibleProperties = [PROPERTY]

    await removalConsumer().handler(removed)

    expect(await assignments()).toEqual([
      { portal_id: PORTAL, effective_to: null, end_reason: null },
      {
        portal_id: OTHER_PROPERTY_PORTAL,
        effective_to: DELIVERED_AT,
        end_reason: 'manager_offboarded',
      },
    ])
    expect(await gapFacts()).toEqual([{ portal_id: OTHER_PROPERTY_PORTAL, actor: ADMIN }])
  })

  it('ends an assignment that commits after the removal was already consumed, and refuses the save', async () => {
    // The other admin's save has read the member as eligible. Before it
    // commits, the membership delete commits and the worker consumes its fact:
    // nothing is held yet, so nothing is released, and the receipt is written.
    // No later delivery will look again.
    const consumed: ConsumerEvent[] = []
    afterNextManagerRead = async () => {
      const removed = await removeMembership()
      await removalConsumer().handler(removed)
      consumed.push(removed)
    }

    await expect(
      saveManagers(
        { portalId: PORTAL, managerUserIds: [DEPARTING], expectedRevision: 1 },
        buildTestAuthContext({
          userId: userId(ADMIN),
          organizationId: organizationId(ORG),
          role: 'AccountAdmin',
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'responsible_manager_ineligible',
    })

    expect(consumed).toHaveLength(1)
    expect(await receipts(consumed[0]!.eventId)).toEqual([
      { consumer_name: 'portal.on-member-removed', status: 'applied' },
    ])
    // The clock has not moved since the assignment was stamped, and an
    // interval ends after it began.
    const releasedAt = new Date(COMMITTED_AT.getTime() + 1)
    expect(await assignments()).toEqual([
      {
        portal_id: PORTAL,
        effective_to: releasedAt,
        end_reason: 'manager_became_ineligible',
      },
    ])
    // Nobody chose this gap, so nobody is left out of the notice.
    expect(await neededSince(PORTAL)).toEqual(releasedAt)
    expect(await gapFacts()).toEqual([{ portal_id: PORTAL, actor: null }])
  })

  it('runs under its own ungated, Organization-scoped catalogue row', () => {
    const row = ENTRY_POINT_CATALOGUE.find(
      (candidate) =>
        candidate.kind === 'consumer' && candidate.name === removalConsumer().module,
    )

    // Cleanup: a denied consumer is never retried, so no capability may skip it.
    expect(row).toEqual({
      kind: 'consumer',
      name: 'portal.member-offboarding',
      action: 'system:portal.release_member_responsibility',
      capability: 'none',
      resourceScope: 'organization',
      externalEffect: false,
    })
    expect(capabilityForSystemAction(row!.action)).toBe('none')
  })
})
