// Recognition notifications used to say "Goal completed" with no goal, and
// "Badge definition: <uuid>" with no badge. These lookups are what replaced
// that, so they need real SQL against the real schema: the goal→property join
// and the two award-target tables are exactly what a fake `db` cannot prove.

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  badgeId,
  goalId,
  organizationId,
  portalGroupId,
  portalId,
} from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createRecognitionLookupAdapter } from './recognition-lookup.adapter'

const ORG_A = organizationId('11111111-1111-4111-8111-111111111111')
const ORG_B = organizationId('22222222-2222-4222-8222-222222222222')
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'
const GOAL_ID = '44444444-4444-4444-8444-444444444444'
const PORTAL_ID = '55555555-5555-4555-8555-555555555555'
const PORTAL_GROUP_ID = '66666666-6666-4666-8666-666666666666'
const BADGE_DEF_ID = '77777777-7777-4777-8777-777777777777'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['goals', 'portals', 'portal_groups', 'properties'],
})

const db = (): Database => drizzle(getPool()) as unknown as Database

async function seedProperty(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, lifecycle_state)
     VALUES ($1, $2, 'Riverside Hotel', 'riverside', 'Europe/Sofia', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_ID, ORG_A],
  )
}

async function seedGoal(): Promise<void> {
  await getPool().query(
    `INSERT INTO goals
       (id, organization_id, property_id, name, created_by, goal_type,
        aggregation_function, metric_key, target_value)
     VALUES ($1, $2, $3, 'Weekend response time', 'test', 'one_shot',
             'avg', 'property.review', 4.5)
     ON CONFLICT (id) DO NOTHING`,
    [GOAL_ID, ORG_A, PROPERTY_ID],
  )
}

async function seedBadgeDefinition(): Promise<void> {
  await getPool().query(
    `INSERT INTO badge_definitions (id, key, name, target_scope, criteria_json)
     VALUES ($1, 'fast-responder', 'Fast Responder', 'portal', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [BADGE_DEF_ID],
  )
}

async function seedPortals(): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3, 'property', $3, 'Front desk', 'front-desk')
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL_ID, ORG_A, PROPERTY_ID],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, 'Housekeeping')
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL_GROUP_ID, ORG_A, PROPERTY_ID],
  )
}

describe('createRecognitionLookupAdapter', () => {
  beforeEach(async () => {
    await getPool().query(`DELETE FROM badge_definitions WHERE id = $1`, [BADGE_DEF_ID])
  })

  it('resolves the goal name and its property name', async () => {
    await seedProperty()
    await seedGoal()

    await expect(
      createRecognitionLookupAdapter(db()).findGoalFacts(goalId(GOAL_ID), ORG_A),
    ).resolves.toEqual({
      goalName: 'Weekend response time',
      propertyName: 'Riverside Hotel',
    })
  })

  it('does not resolve a goal across organizations', async () => {
    await seedProperty()
    await seedGoal()

    await expect(
      createRecognitionLookupAdapter(db()).findGoalFacts(goalId(GOAL_ID), ORG_B),
    ).resolves.toBeNull()
  })

  it('resolves a portal award target by name', async () => {
    await seedProperty()
    await seedPortals()
    await seedBadgeDefinition()

    await expect(
      createRecognitionLookupAdapter(db()).findBadgeFacts({
        badgeDefinitionId: badgeId(BADGE_DEF_ID),
        target: { kind: 'portal', id: portalId(PORTAL_ID) },
        orgId: ORG_A,
      }),
    ).resolves.toEqual({ badgeName: 'Fast Responder', recipientName: 'Front desk' })
  })

  it('resolves a portal-group award target by name', async () => {
    await seedProperty()
    await seedPortals()
    await seedBadgeDefinition()

    await expect(
      createRecognitionLookupAdapter(db()).findBadgeFacts({
        badgeDefinitionId: badgeId(BADGE_DEF_ID),
        target: { kind: 'portal_group', id: portalGroupId(PORTAL_GROUP_ID) },
        orgId: ORG_A,
      }),
    ).resolves.toEqual({ badgeName: 'Fast Responder', recipientName: 'Housekeeping' })
  })

  it('keeps the badge name when the target belongs to another organization', async () => {
    await seedProperty()
    await seedPortals()
    await seedBadgeDefinition()

    // The badge catalogue is global; the target is tenant-scoped. A mismatch
    // must degrade the recipient clause, not invent one.
    await expect(
      createRecognitionLookupAdapter(db()).findBadgeFacts({
        badgeDefinitionId: badgeId(BADGE_DEF_ID),
        target: { kind: 'portal', id: portalId(PORTAL_ID) },
        orgId: ORG_B,
      }),
    ).resolves.toEqual({ badgeName: 'Fast Responder', recipientName: null })
  })

  it('returns null when the badge definition is gone', async () => {
    await seedProperty()
    await seedPortals()

    await expect(
      createRecognitionLookupAdapter(db()).findBadgeFacts({
        badgeDefinitionId: badgeId(BADGE_DEF_ID),
        target: { kind: 'portal', id: portalId(PORTAL_ID) },
        orgId: ORG_A,
      }),
    ).resolves.toBeNull()
  })
})
