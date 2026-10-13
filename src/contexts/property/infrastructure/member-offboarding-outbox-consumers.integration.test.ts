// A Responsible Manager assigned in the gap of their own offboarding, against
// real PostgreSQL and through the Property context as the worker wires it.
//
// Removing a member releases their responsibilities first and deletes the
// membership afterwards, in separate commits (the Google fences cannot join the
// Identity transaction). In between the member is still eligible, so an
// assignment another admin saves there is accepted, and the release that ran
// before it cannot see it.

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
import type { ResponsibleManagerMembership } from '#/shared/responsible-manager-eligibility'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildPropertyContext } from '../build'
import { createPropertyRepository } from './repositories/property.repository'

const ORG = organizationId('org-property-offboarding-gap')
const PROPERTY = propertyId('fa100000-0000-4000-8000-000000000001')
const ADMIN = userId('admin-property-offboarding-gap')
const DEPARTING = userId('departing-property-offboarding-gap')
const ASSIGNED_AT = new Date('2026-10-13T09:00:00.000Z')
const REMOVED_AT = new Date('2026-10-13T09:00:01.000Z')
const DELIVERED_AT = new Date('2026-10-13T09:00:05.000Z')

const manager = (id: string): ResponsibleManagerMembership => ({
  userId: id,
  role: 'AccountAdmin',
  propertyAccessScope: 'organization',
})

const db = getDb()
const outbox = createOutboxRepository(db)
let pool: Pool
let now = ASSIGNED_AT
/** Identity's current managers of the Organization. */
let members: readonly ResponsibleManagerMembership[] = []

const property = buildPropertyContext({
  db,
  repo: createPropertyRepository(db),
  outboxRepo: outbox,
  clock: () => now,
  idGen: () => 'faf00000-0000-4000-8000-000000000001',
  staffPublicApi: {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  },
  identityManagerFacts: { listActiveManagers: async () => members },
  logger: { info: () => {}, warn: () => {} },
})

const admin = buildTestAuthContext({
  userId: ADMIN,
  organizationId: ORG,
  role: 'AccountAdmin',
})

/** Another admin names the departing member while they are still a member. */
async function assignInTheGap(): Promise<void> {
  now = ASSIGNED_AT
  const { revision } =
    await property.publicApi.management.listPropertyResponsibleManagers(
      { propertyId: PROPERTY },
      admin,
    )
  await property.publicApi.management.updatePropertyResponsibleManagers(
    { propertyId: PROPERTY, managerUserIds: [DEPARTING], expectedRevision: revision },
    admin,
  )
}

/** The membership delete commits, with the fact every removal path records. */
async function removeMembership(): Promise<ConsumerEvent> {
  members = members.filter((member) => member.userId !== DEPARTING)
  const fact = identityMemberRemoved({
    organizationId: ORG,
    userId: DEPARTING,
    removedBy: ADMIN,
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

/** What Property's worker registers for the fact. */
function removalConsumers() {
  const registry = createConsumerRegistry()
  property.worker.registerOutboxConsumers(registry)
  return registry.listFor('identity.member.removed')
}

/** Deliver the fact to every consumer Property registers for it. */
async function deliver(event: ConsumerEvent) {
  now = DELIVERED_AT
  const results = []
  for (const consumer of removalConsumers()) {
    results.push(await consumer.handler(event))
  }
  return results
}

const assignments = async () =>
  (
    await pool.query<{ user_id: string; effective_to: Date | null; end_reason: string }>(
      `SELECT user_id, effective_to, end_reason FROM property_responsible_managers
       WHERE organization_id = $1 AND property_id = $2 ORDER BY effective_from`,
      [ORG, PROPERTY],
    )
  ).rows

const neededSince = async () =>
  (
    await pool.query<{ responsibility_needed_since: Date | null }>(
      'SELECT responsibility_needed_since FROM properties WHERE id = $1',
      [PROPERTY],
    )
  ).rows[0]?.responsibility_needed_since

const gapFacts = async () =>
  (
    await pool.query<{ actor: string | null }>(
      `SELECT payload->>'actorUserId' AS actor FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'property.responsibility_became_needed'`,
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
  await pool.query(
    'DELETE FROM property_responsible_managers WHERE organization_id = $1',
    [ORG],
  )
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
  members = [manager(ADMIN), manager(DEPARTING)]
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Offboarding Gap', 'offboarding-gap', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
})

describe.sequential(
  'Property responsibility across a member removal (PostgreSQL)',
  () => {
    it('releases a manager who was assigned after their offboarding released them', async () => {
      await assignInTheGap()
      const removed = await removeMembership()

      await deliver(removed)

      // No longer the Property's manager, and the gap is recorded and announced:
      // the admin who removed them is the one who opened it.
      expect(await assignments()).toEqual([
        {
          user_id: DEPARTING,
          effective_to: DELIVERED_AT,
          end_reason: 'manager_offboarded',
        },
      ])
      expect(await neededSince()).toEqual(DELIVERED_AT)
      expect(await gapFacts()).toEqual([{ actor: ADMIN }])
      expect(await receipts(removed.eventId)).toEqual([
        { consumer_name: 'property.on-member-removed', status: 'applied' },
      ])
    })

    it('releases nothing twice when the fact is delivered again', async () => {
      await assignInTheGap()
      const removed = await removeMembership()

      await deliver(removed)
      await expect(deliver(removed)).resolves.toEqual([{ status: 'applied' }])

      expect(await assignments()).toHaveLength(1)
      expect(await gapFacts()).toHaveLength(1)
    })

    it('keeps the assignment of a member who is back by the time the fact is delivered', async () => {
      await assignInTheGap()
      const removed = await removeMembership()
      // Invited again and accepted before the worker reached the fact.
      members = [...members, manager(DEPARTING)]

      await expect(deliver(removed)).resolves.toEqual([{ status: 'applied' }])

      expect(await assignments()).toEqual([
        { user_id: DEPARTING, effective_to: null, end_reason: null },
      ])
      expect(await neededSince()).toBeNull()
      expect(await gapFacts()).toEqual([])
    })

    it('runs under its own ungated, Organization-scoped catalogue row', () => {
      const [consumer, ...others] = removalConsumers()
      expect(others).toEqual([])
      const row = ENTRY_POINT_CATALOGUE.find(
        (candidate) =>
          candidate.kind === 'consumer' && candidate.name === consumer?.module,
      )

      // Cleanup: a denied consumer is never retried, so no capability may skip it.
      expect(row).toEqual({
        kind: 'consumer',
        name: 'property.member-offboarding',
        action: 'system:property.release_member_responsibility',
        capability: 'none',
        resourceScope: 'organization',
        externalEffect: false,
      })
      expect(capabilityForSystemAction(row!.action)).toBe('none')
    })
  },
)
