// A Portal that lost its last responsible manager while its Property was
// archived records the gap silently (ADR 0052 amendment): nobody is asked to
// staff something they removed. Restore only requires the PROPERTY to have a
// manager, so without a re-announcement the Portal's gap would stay silent for
// good once the Property is back in the workspace. On `property.restored`,
// every live Portal of the Property that still lacks a manager raises
// `portal.responsibility_became_needed` again (PostgreSQL).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { propertyRestored } from '#/contexts/property/domain/events'
import type { Portal } from '../domain/types'
import { createPostgresPortalFixtureStore } from './testing/postgres-portal-fixture-store'
import { createPortalResponsibilityRecoveryStore } from './repositories/portal-responsible-manager.repository'
import { registerPortalPropertyLifecycleConsumers } from './property-lifecycle-outbox-consumers'

const ORG = 'org-portal-restore-responsibility'
const PROPERTY = 'c9100000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'c9100000-0000-4000-8000-000000000002'
const UNSTAFFED = 'c9100000-0000-4000-8000-000000000011'
const UNSTAFFED_DRAFT = 'c9100000-0000-4000-8000-000000000012'
const STAFFED = 'c9100000-0000-4000-8000-000000000013'
const ARCHIVED = 'c9100000-0000-4000-8000-000000000014'
const DELETED = 'c9100000-0000-4000-8000-000000000015'
const OTHER_PROPERTY_PORTAL = 'c9100000-0000-4000-8000-000000000016'
const ADMIN = 'admin-portal-restore-responsibility'
const CREATED = new Date('2026-09-01T10:00:00.000Z')
const GAP_SINCE = new Date('2026-09-10T10:00:00.000Z')
const RESTORED_AT = new Date('2026-09-22T09:00:00.000Z')

const db = getDb()
let pool: Pool

const portal = (
  id: string,
  overrides: Partial<Omit<Portal, 'id'>> = {},
  property: string = PROPERTY,
): Portal =>
  buildTestPortal({
    id,
    organizationId: organizationId(ORG),
    propertyId: propertyId(property),
    entityId: propertyId(property),
    slug: `restore-responsibility-${id.slice(-2)}`,
    publicationState: 'published',
    createdBy: userId(ADMIN),
    responsibilityNeededSince: GAP_SINCE,
    createdAt: CREATED,
    updatedAt: GAP_SINCE,
    ...overrides,
  })

async function seedPortals(): Promise<void> {
  const fixtures = createPostgresPortalFixtureStore(db)
  // Lost its last manager while the Property was archived: silent gap.
  await fixtures.insert(organizationId(ORG), portal(UNSTAFFED))
  await fixtures.insert(
    organizationId(ORG),
    portal(UNSTAFFED_DRAFT, { publicationState: 'draft' }),
  )
  // Has a manager again: nothing is needed.
  await fixtures.insert(
    organizationId(ORG),
    portal(STAFFED, { responsibilityNeededSince: null }),
    userId(ADMIN),
  )
  // Outside the workspace even with the Property back.
  await fixtures.insert(
    organizationId(ORG),
    portal(ARCHIVED, { publicationState: 'archived' }),
  )
  await fixtures.insert(organizationId(ORG), portal(DELETED, { deletedAt: GAP_SINCE }))
  // Another Property's Portal is not this fact's business.
  await fixtures.insert(
    organizationId(ORG),
    portal(OTHER_PROPERTY_PORTAL, {}, OTHER_PROPERTY),
  )
}

async function setLifecycle(state: 'active' | 'archived', sourceEpoch: number) {
  await pool.query(
    `UPDATE properties SET lifecycle_state = $2, source_epoch = $3 WHERE id = $1`,
    [PROPERTY, state, sourceEpoch],
  )
}

/** Record the restore fact and return it as the dispatcher delivers it. */
async function recordRestore(): Promise<ConsumerEvent> {
  const fact = propertyRestored({
    organizationId: organizationId(ORG),
    propertyId: propertyId(PROPERTY),
    userId: userId(ADMIN),
    previousState: 'archived',
    sourceEpoch: 2,
    googleBindingReadiness: 'ready',
    occurredAt: RESTORED_AT,
  })
  const row = toOutboxEvent(fact)
  await createOutboxRepository(db).insert({ ...row, id: fact.eventId })
  return {
    eventId: fact.eventId,
    eventType: fact._tag,
    eventVersion: 1,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'property',
    sourceAggregateId: PROPERTY,
    occurredAt: RESTORED_AT.toISOString(),
    payload: row.payload,
  }
}

/** The Portal consumer registered for `property.restored`, as its worker wires it. */
function restoreConsumer() {
  const registry = createConsumerRegistry()
  registerPortalPropertyLifecycleConsumers(registry, {
    recoveryStore: createPortalResponsibilityRecoveryStore(db),
    clock: () => RESTORED_AT,
  })
  const registrations = registry.listFor('property.restored')
  expect(registrations).toHaveLength(1)
  return registrations[0]!
}

const recoveryFacts = async () =>
  (
    await pool.query<{ portal_id: string; property_id: string; recorded_at: Date }>(
      `SELECT payload->>'portalId' AS portal_id,
              payload->>'propertyId' AS property_id,
              created_at AS recorded_at
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'portal.responsibility_became_needed'
       ORDER BY payload->>'portalId'`,
      [ORG],
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
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $1, $1, NOW())`,
    [ORG],
  )
  for (const [id, slug] of [
    [PROPERTY, 'restore-responsibility'],
    [OTHER_PROPERTY, 'restore-responsibility-other'],
  ]) {
    await pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Restored Property', $3, 'UTC', NOW(), NOW())`,
      [id, ORG, slug],
    )
  }
  await seedPortals()
})

describe.sequential(
  'Portal responsibility across a Property Restore (PostgreSQL)',
  () => {
    it('raises the recovery fact again for each live Portal that still has no manager', async () => {
      await setLifecycle('active', 2)
      const consumer = restoreConsumer()
      const restored = await recordRestore()

      await expect(consumer.handler(restored)).resolves.toEqual({ status: 'applied' })

      expect(await recoveryFacts()).toEqual([
        { portal_id: UNSTAFFED, property_id: PROPERTY, recorded_at: RESTORED_AT },
        { portal_id: UNSTAFFED_DRAFT, property_id: PROPERTY, recorded_at: RESTORED_AT },
      ])
    })

    it('raises it once however often the fact is delivered', async () => {
      await setLifecycle('active', 2)
      const consumer = restoreConsumer()
      const restored = await recordRestore()

      await consumer.handler(restored)
      await expect(consumer.handler(restored)).resolves.toEqual({ status: 'duplicate' })

      expect(await recoveryFacts()).toHaveLength(2)
    })

    it('stays silent when the Property was archived again before delivery', async () => {
      await setLifecycle('archived', 3)
      const consumer = restoreConsumer()
      const restored = await recordRestore()

      await expect(consumer.handler(restored)).resolves.toEqual({ status: 'obsolete' })

      expect(await recoveryFacts()).toEqual([])
    })

    it('runs under a Property-scoped catalogue row', () => {
      const row = ENTRY_POINT_CATALOGUE.find(
        (candidate) =>
          candidate.kind === 'consumer' && candidate.name === restoreConsumer().module,
      )

      expect(row).toMatchObject({
        name: 'portal.property-lifecycle',
        resourceScope: 'property',
        externalEffect: false,
      })
    })
  },
)
