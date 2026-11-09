import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { CreatePortalGroupCommand } from '../application/ports/portal-command-store.port'
import {
  portalAddedToGroup,
  portalGroupCreated,
  portalGroupUpdated,
} from '../domain/events'
import { portalToRow } from '../infrastructure/mappers/portal.mapper'
import { createPortalGroupCommands } from './portal-group-commands.server'

const ORG = organizationId('org-group-name-collision-a')
const OTHER_ORG = organizationId('org-group-name-collision-b')
const PROPERTY = propertyId('9a000000-0000-4000-8000-000000000001')
const PORTAL = portalId('9b000000-0000-4000-8000-000000000001')
const GROUP = portalGroupId('9c000000-0000-4000-8000-000000000001')
const NEW_GROUP = portalGroupId('9c000000-0000-4000-8000-000000000002')
const MANAGER = userId('group-name-collision-manager')
const BEFORE = new Date('2026-11-01T10:00:00Z')
const AFTER = new Date('2026-11-01T10:00:01Z')
const NAME = 'Reception'

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Reception', 'reception', 'UTC')`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Original', $4, $4)`,
    [GROUP, ORG, PROPERTY, BEFORE],
  )
  await getDb()
    .insert(portals)
    .values(
      portalToRow(
        buildTestPortal({
          id: PORTAL,
          organizationId: ORG,
          propertyId: PROPERTY,
          entityId: PROPERTY,
          name: 'Reception Portal',
          slug: 'reception',
          createdBy: MANAGER,
          createdAt: BEFORE,
          updatedAt: BEFORE,
        }),
      ),
    )
})

function createCommand(withMember: boolean): CreatePortalGroupCommand {
  const fact = {
    organizationId: ORG,
    propertyId: PROPERTY,
    portalGroupId: NEW_GROUP,
    sourceAggregateVersion: AFTER.toISOString(),
    occurredAt: AFTER,
  }
  return {
    organizationId: ORG,
    changedBy: MANAGER,
    group: {
      id: NEW_GROUP,
      organizationId: ORG,
      propertyId: PROPERTY,
      name: NAME,
      sortKey: null,
      createdBy: MANAGER,
      createdAt: AFTER,
      updatedAt: AFTER,
      deletedAt: null,
    },
    sourceGroups: [],
    memberships: withMember
      ? [{ portalId: PORTAL, createdBy: MANAGER, movedFrom: null }]
      : [],
    events: [
      portalGroupCreated({ ...fact, name: NAME }),
      ...(withMember ? [portalAddedToGroup({ ...fact, portalId: PORTAL })] : []),
    ],
  }
}

async function waitForBlockedCommands(client: PoolClient, count: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    await client.query('SELECT pg_stat_clear_snapshot()')
    const { rows } = await client.query<{ waiting: number }>(
      `WITH RECURSIVE waiting AS (
         SELECT pid FROM pg_stat_activity
         WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))
         UNION
         SELECT activity.pid FROM pg_stat_activity activity
         JOIN waiting ON waiting.pid = ANY(pg_blocking_pids(activity.pid))
       ) SELECT count(*)::int AS waiting FROM waiting`,
    )
    if (rows[0]?.waiting === count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Expected ${count} group commands waiting on database locks`)
}

describe.sequential('Portal Group creation colliding with rename', () => {
  it.each([true, false])(
    'returns a name refusal without deadlocking when creation has a member: %s',
    async (withMember) => {
      const store = createPortalGroupCommands(getDb())
      const gate = await getPool().connect()
      const pending: Promise<PromiseSettledResult<void>>[] = []
      try {
        await gate.query('BEGIN')
        await gate.query('SELECT id FROM portal_groups WHERE id = $1 FOR UPDATE', [GROUP])
        pending.push(
          Promise.allSettled([
            store.updatePortalGroup({
              organizationId: ORG,
              propertyId: PROPERTY,
              portalGroupId: GROUP,
              expectedUpdatedAt: BEFORE,
              revision: AFTER,
              occurredAt: AFTER,
              name: NAME,
              previousName: 'Original',
              changedBy: MANAGER,
              event: portalGroupUpdated({
                organizationId: ORG,
                propertyId: PROPERTY,
                portalGroupId: GROUP,
                name: NAME,
                sourceAggregateVersion: AFTER.toISOString(),
                occurredAt: AFTER,
              }),
            }),
          ]).then(([result]) => result!),
        )
        // Rename holds the Property fence while it waits for this group row.
        await waitForBlockedCommands(gate, 1)
        pending.push(
          Promise.allSettled([store.createPortalGroup(createCommand(withMember))]).then(
            ([result]) => result!,
          ),
        )
        // Creation must wait before reserving the name, even without source groups.
        await waitForBlockedCommands(gate, 2)
      } finally {
        await gate.query('ROLLBACK')
        gate.release()
        await Promise.all(pending)
      }

      const [renamed, created] = await Promise.all(pending)
      expect(renamed).toMatchObject({ status: 'fulfilled' })
      expect(created).toMatchObject({
        status: 'rejected',
        reason: { code: 'group_name_taken' },
      })
      const groups = await getPool().query(
        'SELECT id, name, updated_at FROM portal_groups WHERE organization_id = $1',
        [ORG],
      )
      expect(groups.rows).toEqual([{ id: GROUP, name: NAME, updated_at: AFTER }])
      const members = await getPool().query(
        'SELECT id FROM portal_group_memberships WHERE organization_id = $1',
        [ORG],
      )
      expect(members.rows).toEqual([])
      const history = await getPool().query(
        'SELECT portal_group_id, kind FROM portal_group_history WHERE organization_id = $1',
        [ORG],
      )
      expect(history.rows).toEqual([{ portal_group_id: GROUP, kind: 'renamed' }])
      const facts = await getPool().query(
        'SELECT event_type FROM outbox_events WHERE organization_id = $1',
        [ORG],
      )
      expect(facts.rows).toEqual([{ event_type: 'portal_group.updated' }])
    },
  )
})
