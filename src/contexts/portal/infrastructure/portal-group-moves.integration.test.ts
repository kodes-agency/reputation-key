// Portal Group moves, create-with-move and the history ledger, on real
// PostgreSQL: a mocked transaction cannot prove that a failure in the fact or a
// stale fence rolls back both memberships, both group revisions and the ledger,
// or that two moves over the same groups queue instead of deadlocking.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
  type PortalGroupId,
  type PortalId,
} from '#/shared/domain/ids'
import {
  portalAddedToGroup,
  portalCreated,
  portalGroupCreated,
  portalGroupDeleted,
  portalGroupUpdated,
  portalRemovedFromGroup,
} from '../domain/events'
import type { PortalGroup } from '../domain/types'
import type {
  CreatePortalGroupCommand,
  MovePortalToGroupCommand,
} from '../application/ports/portal-command-store.port'
import { createAtomicPortalCommandStore } from './portal-command-store'

const ORG_A = organizationId('org-groupmove-0000-000000000000001')
const ORG_B = organizationId('org-groupmove-0000-000000000000002')
const PROPERTY = propertyId('7a000000-0000-4000-8000-000000000001')
const PORTAL_1 = portalId('7b000000-0000-4000-8000-000000000001')
const PORTAL_2 = portalId('7b000000-0000-4000-8000-000000000002')
const PORTAL_3 = portalId('7b000000-0000-4000-8000-000000000003')
const GROUP_A = portalGroupId('7f000000-0000-4000-8000-00000000000a')
const GROUP_B = portalGroupId('7f000000-0000-4000-8000-00000000000b')
const GROUP_C = portalGroupId('7f000000-0000-4000-8000-00000000000c')
const GROUP_NEW = portalGroupId('7f000000-0000-4000-8000-0000000000ff')
const MANAGER = userId('manager-groupmove-0000000000000001')
const SEEDED_AT = new Date('2026-09-01T10:00:00.000Z')
const GROUP_REVISION = new Date('2026-09-02T10:00:00.000Z')
const MOVED_AT = new Date('2026-09-30T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    'outbox_events',
    'portal_responsible_managers',
    'portals',
    'properties',
  ],
})

/** The driver error may sit under the ORM's wrapper. */
function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  let current = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

const store = () => createAtomicPortalCommandStore(getDb())

async function seedPortal(id: PortalId, slug: string): Promise<void> {
  const portal = buildTestPortal({
    id,
    organizationId: ORG_A,
    propertyId: PROPERTY,
    entityId: PROPERTY,
    name: slug,
    slug,
    createdBy: MANAGER,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  })
  await store().createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
}

async function seedGroup(id: PortalGroupId, name: string): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, ORG_A, PROPERTY, name, SEEDED_AT, GROUP_REVISION],
  )
}

async function seedMembership(portal: PortalId, group: PortalGroupId): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ORG_A, PROPERTY, portal, group, SEEDED_AT, MANAGER],
  )
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Group Move Property', 'group-move-property', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, SEEDED_AT],
  )
  await seedPortal(PORTAL_1, 'one')
  await seedPortal(PORTAL_2, 'two')
  await seedPortal(PORTAL_3, 'three')
  await seedGroup(GROUP_A, 'Group A')
  await seedGroup(GROUP_B, 'Group B')
  await seedGroup(GROUP_C, 'Group C')
})

/** A move command whose revisions are `at` and whose facts agree with them. */
function moveCommand(
  input: Readonly<{
    portal?: PortalId
    from: PortalGroupId | null
    to: PortalGroupId
    at?: Date
    fromExpected?: Date
    toExpected?: Date
  }>,
): MovePortalToGroupCommand {
  const at = input.at ?? MOVED_AT
  const portal = input.portal ?? PORTAL_1
  const base = { organizationId: ORG_A, propertyId: PROPERTY, portalId: portal }
  const fact = (group: PortalGroupId) => ({
    ...base,
    portalGroupId: group,
    sourceAggregateVersion: at.toISOString(),
    occurredAt: at,
  })
  return {
    ...base,
    changedBy: MANAGER,
    occurredAt: at,
    to: {
      portalGroupId: input.to,
      expectedUpdatedAt: input.toExpected ?? GROUP_REVISION,
      revision: at,
      event: portalAddedToGroup(fact(input.to)),
    },
    from: input.from
      ? {
          portalGroupId: input.from,
          expectedUpdatedAt: input.fromExpected ?? GROUP_REVISION,
          revision: at,
          event: portalRemovedFromGroup(fact(input.from)),
        }
      : null,
  }
}

const memberships = async (portal: PortalId = PORTAL_1) =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", effective_from, effective_to, end_reason, created_by
       FROM portal_group_memberships WHERE organization_id = $1 AND portal_id = $2
       ORDER BY effective_from, portal_group_id`,
      [ORG_A, portal],
    )
  ).rows

const historyRows = async () =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", kind, portal_id AS portal,
              other_group_id AS other, name, previous_name, actor_user_id, occurred_at
       FROM portal_group_history WHERE organization_id = $1
       ORDER BY occurred_at, portal_group_id, kind`,
      [ORG_A],
    )
  ).rows

const revisionOf = async (group: PortalGroupId) =>
  (
    await getPool().query(
      `SELECT updated_at FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, group],
    )
  ).rows[0]?.updated_at

const factTypes = async () =>
  (
    await getPool().query(
      `SELECT event_type, payload->>'portalGroupId' AS group_id FROM outbox_events
       WHERE organization_id = $1
         AND event_type LIKE 'portal_group.%'
       ORDER BY event_type, payload->>'portalGroupId'`,
      [ORG_A],
    )
  ).rows

describe.sequential('movePortalToGroup (real PostgreSQL)', () => {
  it('ends the old membership with moved_to_group and begins the new one in one commit', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B }))

    expect(await memberships()).toEqual([
      {
        group: GROUP_A,
        effective_from: SEEDED_AT,
        effective_to: MOVED_AT,
        end_reason: 'moved_to_group',
        created_by: MANAGER,
      },
      {
        group: GROUP_B,
        effective_from: MOVED_AT,
        effective_to: null,
        end_reason: null,
        created_by: MANAGER,
      },
    ])
    expect(await revisionOf(GROUP_A)).toEqual(MOVED_AT)
    expect(await revisionOf(GROUP_B)).toEqual(MOVED_AT)
  })

  it('records a removal fact for the old group and an addition for the new, by identifier', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B }))

    expect(await factTypes()).toEqual([
      { event_type: 'portal_group.portal_added', group_id: GROUP_B },
      { event_type: 'portal_group.portal_removed', group_id: GROUP_A },
    ])
  })

  it('writes history on both groups, naming the Portal, the actor and the other group', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B }))

    expect(await historyRows()).toEqual([
      {
        group: GROUP_A,
        kind: 'portal_moved_out',
        portal: PORTAL_1,
        other: GROUP_B,
        name: null,
        previous_name: null,
        actor_user_id: MANAGER,
        occurred_at: MOVED_AT,
      },
      {
        group: GROUP_B,
        kind: 'portal_moved_in',
        portal: PORTAL_1,
        other: GROUP_A,
        name: null,
        previous_name: null,
        actor_user_id: MANAGER,
        occurred_at: MOVED_AT,
      },
    ])
  })

  it('is a plain addition when the Portal had no group', async () => {
    await store().movePortalToGroup(moveCommand({ from: null, to: GROUP_B }))

    expect(await memberships()).toHaveLength(1)
    expect((await historyRows()).map((row) => row.kind)).toEqual(['portal_added'])
    expect((await factTypes()).map((row) => row.event_type)).toEqual([
      'portal_group.portal_added',
    ])
    expect(await revisionOf(GROUP_A)).toEqual(GROUP_REVISION)
  })

  it('refuses a plain addition for a Portal that has a group', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await expect(
      store().movePortalToGroup(moveCommand({ from: null, to: GROUP_B })),
    ).rejects.toMatchObject({ code: 'portal_already_grouped' })
    expect(await memberships()).toHaveLength(1)
    expect(await revisionOf(GROUP_B)).toEqual(GROUP_REVISION)
  })

  it.each([
    ['the old group', { fromExpected: SEEDED_AT }],
    ['the new group', { toExpected: SEEDED_AT }],
  ])('refuses a stale fence on %s and changes nothing', async (_name, stale) => {
    await seedMembership(PORTAL_1, GROUP_A)

    await expect(
      store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B, ...stale })),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    expect(await memberships()).toEqual([
      expect.objectContaining({ group: GROUP_A, effective_to: null }),
    ])
    expect(await revisionOf(GROUP_A)).toEqual(GROUP_REVISION)
    expect(await revisionOf(GROUP_B)).toEqual(GROUP_REVISION)
    expect(await historyRows()).toEqual([])
    expect(await factTypes()).toEqual([])
  })

  it('refuses a move whose source is no longer the Portal group and rolls back the fences', async () => {
    await seedMembership(PORTAL_1, GROUP_C)

    await expect(
      store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B })),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    expect(await memberships()).toEqual([
      expect.objectContaining({ group: GROUP_C, effective_to: null }),
    ])
    expect(await revisionOf(GROUP_A)).toEqual(GROUP_REVISION)
    expect(await revisionOf(GROUP_B)).toEqual(GROUP_REVISION)
  })

  it('rolls back memberships, fences and history when a fact fails to commit', async () => {
    await seedMembership(PORTAL_1, GROUP_A)
    const command = moveCommand({ from: GROUP_A, to: GROUP_B })
    // The addition fact collides with an existing outbox row, so the commit fails
    // after the memberships, the fences and the history were written.
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_group.portal_added', 1, '{}'::jsonb, $2, $3,
               'portal_group', $4, $5)`,
      [command.to.event.eventId, ORG_A, PROPERTY, GROUP_B, SEEDED_AT],
    )

    await expect(store().movePortalToGroup(command)).rejects.toSatisfy((error: unknown) =>
      hasDatabaseErrorCode(error, '23505'),
    )

    expect(await memberships()).toEqual([
      expect.objectContaining({ group: GROUP_A, effective_to: null, end_reason: null }),
    ])
    expect(await revisionOf(GROUP_A)).toEqual(GROUP_REVISION)
    expect(await revisionOf(GROUP_B)).toEqual(GROUP_REVISION)
    expect(await historyRows()).toEqual([])
  })

  it('refuses a command whose fact belongs to another group', async () => {
    await seedMembership(PORTAL_1, GROUP_A)
    const command = moveCommand({ from: GROUP_A, to: GROUP_B })

    await expect(
      store().movePortalToGroup({
        ...command,
        to: { ...command.to, event: moveCommand({ from: null, to: GROUP_C }).to.event },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_A })),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await memberships()).toHaveLength(1)
  })

  it('refuses a Portal of another Property', async () => {
    await seedMembership(PORTAL_1, GROUP_A)
    const command = moveCommand({ from: GROUP_A, to: GROUP_B })

    await expect(
      store().movePortalToGroup({
        ...command,
        propertyId: propertyId('7a000000-0000-4000-8000-0000000000ee'),
        to: {
          ...command.to,
          event: portalAddedToGroup({
            organizationId: ORG_A,
            propertyId: propertyId('7a000000-0000-4000-8000-0000000000ee'),
            portalGroupId: GROUP_B,
            portalId: PORTAL_1,
            sourceAggregateVersion: MOVED_AT.toISOString(),
            occurredAt: MOVED_AT,
          }),
        },
        from: command.from && {
          ...command.from,
          event: portalRemovedFromGroup({
            organizationId: ORG_A,
            propertyId: propertyId('7a000000-0000-4000-8000-0000000000ee'),
            portalGroupId: GROUP_A,
            portalId: PORTAL_1,
            sourceAggregateVersion: MOVED_AT.toISOString(),
            occurredAt: MOVED_AT,
          }),
        },
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await memberships()).toEqual([
      expect.objectContaining({ group: GROUP_A, effective_to: null }),
    ])
  })

  it('lets exactly one of two moves of the same Portal win', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    const results = await Promise.allSettled([
      store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_B })),
      store().movePortalToGroup(moveCommand({ from: GROUP_A, to: GROUP_C })),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected')
    expect(lost).toMatchObject({ reason: { code: 'revision_conflict' } })
    const active = (await memberships()).filter((row) => row.effective_to === null)
    expect(active).toHaveLength(1)
  })

  it('queues two moves in opposite directions between the same groups, without a deadlock', async () => {
    await seedMembership(PORTAL_1, GROUP_A)
    await seedMembership(PORTAL_2, GROUP_B)

    const results = await Promise.allSettled([
      store().movePortalToGroup(
        moveCommand({ portal: PORTAL_1, from: GROUP_A, to: GROUP_B }),
      ),
      store().movePortalToGroup(
        moveCommand({ portal: PORTAL_2, from: GROUP_B, to: GROUP_A }),
      ),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'revision_conflict' })
      }
    }
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const portal of [PORTAL_1, PORTAL_2]) {
      const active = (await memberships(portal)).filter(
        (row) => row.effective_to === null,
      )
      expect(active).toHaveLength(1)
    }
  })
})

function createCommand(
  overrides: Partial<CreatePortalGroupCommand> & {
    portals: ReadonlyArray<Readonly<{ portal: PortalId; from: PortalGroupId | null }>>
    fromExpected?: Date
  },
): CreatePortalGroupCommand {
  const at = MOVED_AT
  const group: PortalGroup = {
    id: GROUP_NEW,
    organizationId: ORG_A,
    propertyId: PROPERTY,
    name: 'Fresh Group',
    sortKey: null,
    createdBy: MANAGER,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  }
  const sources = [...new Set(overrides.portals.flatMap((p) => (p.from ? [p.from] : [])))]
  const base = { organizationId: ORG_A, propertyId: PROPERTY }
  return {
    organizationId: ORG_A,
    group,
    changedBy: MANAGER,
    memberships: overrides.portals.map(({ portal, from }) => ({
      portalId: portal,
      createdBy: MANAGER,
      movedFrom: from
        ? {
            portalGroupId: from,
            event: portalRemovedFromGroup({
              ...base,
              portalGroupId: from,
              portalId: portal,
              sourceAggregateVersion: at.toISOString(),
              occurredAt: at,
            }),
          }
        : null,
    })),
    sourceGroups: sources.map((source) => ({
      portalGroupId: source,
      expectedUpdatedAt: overrides.fromExpected ?? GROUP_REVISION,
      revision: at,
    })),
    events: [
      portalGroupCreated({
        ...base,
        portalGroupId: GROUP_NEW,
        name: group.name,
        sourceAggregateVersion: at.toISOString(),
        occurredAt: at,
      }),
      ...overrides.portals.map(({ portal }) =>
        portalAddedToGroup({
          ...base,
          portalGroupId: GROUP_NEW,
          portalId: portal,
          sourceAggregateVersion: at.toISOString(),
          occurredAt: at,
        }),
      ),
    ],
  }
}

describe.sequential('createPortalGroup with moves (real PostgreSQL)', () => {
  it('creates the group, moves Portals out of their groups and writes history in one commit', async () => {
    await seedMembership(PORTAL_1, GROUP_A)
    await seedMembership(PORTAL_2, GROUP_A)

    await store().createPortalGroup(
      createCommand({
        portals: [
          { portal: PORTAL_1, from: GROUP_A },
          { portal: PORTAL_2, from: GROUP_A },
          { portal: PORTAL_3, from: null },
        ],
      }),
    )

    for (const portal of [PORTAL_1, PORTAL_2]) {
      expect(await memberships(portal)).toEqual([
        expect.objectContaining({
          group: GROUP_A,
          effective_to: MOVED_AT,
          end_reason: 'moved_to_group',
        }),
        expect.objectContaining({ group: GROUP_NEW, effective_to: null }),
      ])
    }
    expect(await memberships(PORTAL_3)).toEqual([
      expect.objectContaining({ group: GROUP_NEW, effective_to: null }),
    ])
    expect(await revisionOf(GROUP_A)).toEqual(MOVED_AT)
    const created = await getPool().query(
      `SELECT created_by FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_NEW],
    )
    expect(created.rows).toEqual([{ created_by: MANAGER }])
    expect((await historyRows()).map((row) => [row.group, row.kind, row.portal])).toEqual(
      expect.arrayContaining([
        [GROUP_NEW, 'created', null],
        [GROUP_A, 'portal_moved_out', PORTAL_1],
        [GROUP_A, 'portal_moved_out', PORTAL_2],
        [GROUP_NEW, 'portal_moved_in', PORTAL_1],
        [GROUP_NEW, 'portal_moved_in', PORTAL_2],
        [GROUP_NEW, 'portal_added', PORTAL_3],
      ]),
    )
    expect(await historyRows()).toHaveLength(6)
    const facts = (await factTypes()).map((row) => row.event_type)
    expect(facts.filter((type) => type === 'portal_group.portal_removed')).toHaveLength(2)
    expect(facts.filter((type) => type === 'portal_group.portal_added')).toHaveLength(3)
    expect(facts.filter((type) => type === 'portal_group.created')).toHaveLength(1)
  })

  it('refuses a stale source fence and creates nothing', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await expect(
      store().createPortalGroup(
        createCommand({
          portals: [{ portal: PORTAL_1, from: GROUP_A }],
          fromExpected: SEEDED_AT,
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    const created = await getPool().query(
      `SELECT id FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_NEW],
    )
    expect(created.rows).toEqual([])
    expect(await memberships()).toEqual([
      expect.objectContaining({ group: GROUP_A, effective_to: null }),
    ])
    expect(await historyRows()).toEqual([])
  })

  it('refuses a Portal that has a group the command did not know about', async () => {
    await seedMembership(PORTAL_1, GROUP_A)

    await expect(
      store().createPortalGroup(
        createCommand({ portals: [{ portal: PORTAL_1, from: null }] }),
      ),
    ).rejects.toMatchObject({ code: 'portal_already_grouped' })
    expect(await historyRows()).toEqual([])
  })

  it('refuses a departure that names a group the Portal is not in', async () => {
    await seedMembership(PORTAL_1, GROUP_C)

    await expect(
      store().createPortalGroup(
        createCommand({ portals: [{ portal: PORTAL_1, from: GROUP_A }] }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await revisionOf(GROUP_A)).toEqual(GROUP_REVISION)
  })

  it('refuses a command whose creator does not match the group', async () => {
    const command = createCommand({ portals: [] })

    await expect(
      store().createPortalGroup({ ...command, changedBy: userId('someone-else') }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe.sequential(
  'group history for the other group commands (real PostgreSQL)',
  () => {
    it('records a rename with the previous name and who made it, and nothing for the same name', async () => {
      const rename = (name: string, previousName: string, at: Date, expected: Date) =>
        store().updatePortalGroup({
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalGroupId: GROUP_A,
          expectedUpdatedAt: expected,
          name,
          previousName,
          changedBy: MANAGER,
          revision: at,
          occurredAt: at,
          event: portalGroupUpdated({
            organizationId: ORG_A,
            propertyId: PROPERTY,
            portalGroupId: GROUP_A,
            name,
            sourceAggregateVersion: at.toISOString(),
            occurredAt: at,
          }),
        })
      const later = new Date(MOVED_AT.getTime() + 60_000)

      await rename('Lobby', 'Group A', MOVED_AT, GROUP_REVISION)
      await rename('Lobby', 'Lobby', later, MOVED_AT)

      expect(await historyRows()).toEqual([
        expect.objectContaining({
          group: GROUP_A,
          kind: 'renamed',
          name: 'Lobby',
          previous_name: 'Group A',
          actor_user_id: MANAGER,
        }),
      ])
    })

    it('records add, remove and archive with their actor', async () => {
      const base = { organizationId: ORG_A, propertyId: PROPERTY, portalGroupId: GROUP_A }
      const t1 = new Date(MOVED_AT.getTime() + 1000)
      const t2 = new Date(MOVED_AT.getTime() + 2000)
      const fact = (at: Date) => ({
        ...base,
        portalId: PORTAL_1,
        sourceAggregateVersion: at.toISOString(),
        occurredAt: at,
      })
      await store().addPortalToGroup({
        ...base,
        portalId: PORTAL_1,
        expectedUpdatedAt: GROUP_REVISION,
        revision: MOVED_AT,
        occurredAt: MOVED_AT,
        changedBy: MANAGER,
        event: portalAddedToGroup(fact(MOVED_AT)),
      })
      await store().removePortalFromGroup({
        ...base,
        portalId: PORTAL_1,
        expectedUpdatedAt: MOVED_AT,
        revision: t1,
        occurredAt: t1,
        changedBy: MANAGER,
        event: portalRemovedFromGroup(fact(t1)),
      })
      await store().deletePortalGroup({
        ...base,
        expectedUpdatedAt: t1,
        revision: t2,
        occurredAt: t2,
        changedBy: MANAGER,
        event: portalGroupDeleted({
          ...base,
          sourceAggregateVersion: t2.toISOString(),
          occurredAt: t2,
        }),
      })

      expect((await historyRows()).map((row) => [row.kind, row.actor_user_id])).toEqual([
        ['portal_added', MANAGER],
        ['portal_removed', MANAGER],
        ['archived', MANAGER],
      ])
    })

    it('refuses rows that break the shape of the ledger', async () => {
      await expect(
        getPool().query(
          `INSERT INTO portal_group_history
           (organization_id, property_id, portal_group_id, kind, actor_user_id, occurred_at)
         VALUES ($1, $2, $3, 'portal_added', $4, now())`,
          [ORG_A, PROPERTY, GROUP_A, MANAGER],
        ),
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        getPool().query(
          `INSERT INTO portal_group_history
           (organization_id, property_id, portal_group_id, kind, actor_user_id, occurred_at)
         VALUES ($1, $2, $3, 'invented', $4, now())`,
          [ORG_A, PROPERTY, GROUP_A, MANAGER],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  },
)
