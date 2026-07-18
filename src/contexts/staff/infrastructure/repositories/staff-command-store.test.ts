// BQC-3.5 — staff command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real staff_assignments table:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no assignment row survives, no soft-delete lands.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. Guards hold on the real DB: duplicate assignment, missing soft-delete
//      target. updatePortals commits the whole diff + every fact in one tx.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  portalId,
  propertyId,
  staffAssignmentId,
  userId,
} from '#/shared/domain/ids'
import type { StaffAssignment } from '../../domain/types'
import { staffAssigned, staffUnassigned } from '../../domain/events'
import { isStaffError } from '../../domain/errors'
import { createAtomicStaffCommandStore } from '../staff-command-store'

const ORG_ID = organizationId('org-staffcmd-0000-0000-000000000001')
const PROP_ID = propertyId('5a000000-0000-0000-0000-000000000001')
const USER_ID = userId('user-staffcmd-00000000000000000001')
const PORTAL_A = portalId('5b000000-0000-0000-0000-000000000001')
const PORTAL_B = portalId('5b000000-0000-0000-0000-000000000002')
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

function makeAssignment(overrides: Partial<StaffAssignment> = {}): StaffAssignment {
  return {
    id: staffAssignmentId(crypto.randomUUID()),
    organizationId: ORG_ID,
    userId: USER_ID,
    propertyId: PROP_ID,
    teamId: null,
    portalId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

const assignedEvent = (assignment: StaffAssignment) =>
  staffAssigned({
    assignmentId: assignment.id,
    organizationId: assignment.organizationId,
    userId: assignment.userId,
    propertyId: assignment.propertyId,
    teamId: assignment.teamId,
    portalId: assignment.portalId,
    occurredAt: assignment.createdAt,
  })

const unassignedEvent = (assignment: StaffAssignment) =>
  staffUnassigned({
    assignmentId: assignment.id,
    organizationId: assignment.organizationId,
    userId: assignment.userId,
    propertyId: assignment.propertyId,
    portalId: assignment.portalId,
    occurredAt: NOW,
  })

async function seedOrgAndProperty(p: Pool) {
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, 'Staff Cmd Org', 'staffcmd-org'],
  )
  await p.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_ID, ORG_ID, 'Staff Cmd Property', 'staffcmd-prop', 'UTC'],
  )
  await p.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $3, $4, $5, NOW(), NOW()),
            ($6, $2, $3, 'property', $3, $7, $8, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      PORTAL_A,
      ORG_ID,
      PROP_ID,
      'Staff Cmd Portal',
      'staffcmd-portal',
      PORTAL_B,
      'Staff Cmd Portal B',
      'staffcmd-portal-b',
    ],
  )
}

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM staff_assignments WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.query('DELETE FROM portals WHERE id IN ($1, $2)', [PORTAL_A, PORTAL_B])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('staffCommandStore (integration)', () => {
  it('assignStaff commits the assignment + fact in one transaction', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const assignment = makeAssignment()
    const event = assignedEvent(assignment)

    await store.assignStaff({ assignment, event })

    const rows = await pool.query(
      'SELECT id, user_id, property_id, deleted_at FROM staff_assignments WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].id).toBe(assignment.id as string)
    expect(rows.rows[0].deleted_at).toBeNull()
    const facts = await pool.query(
      `SELECT id, event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'staff.assigned'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(event.eventId)
  })

  it('assignStaff rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const assignment = makeAssignment()
    const ghost = {
      ...assignedEvent(assignment),
      _tag: 'staff.ghost',
    } as unknown as Parameters<typeof store.assignStaff>[0]['event']

    await expect(store.assignStaff({ assignment, event: ghost })).rejects.toThrow()

    const rows = await pool.query(
      'SELECT id FROM staff_assignments WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('assignStaff rejects a duplicate and records no fact', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const assignment = makeAssignment()
    await store.assignStaff({ assignment, event: assignedEvent(assignment) })

    await expect(
      store.assignStaff({
        assignment: makeAssignment(),
        event: assignedEvent(makeAssignment()),
      }),
    ).rejects.toSatisfy((e: unknown) => isStaffError(e) && e.code === 'already_assigned')

    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'staff.assigned'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('unassignStaff soft-deletes + records the fact in one transaction', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const assignment = makeAssignment()
    await store.assignStaff({ assignment, event: assignedEvent(assignment) })
    const event = unassignedEvent(assignment)

    await store.unassignStaff({
      assignmentId: assignment.id,
      organizationId: ORG_ID,
      event,
    })

    const rows = await pool.query(
      'SELECT deleted_at FROM staff_assignments WHERE id = $1',
      [assignment.id as string],
    )
    expect(rows.rows[0].deleted_at).not.toBeNull()
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'staff.unassigned' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('unassignStaff throws assignment_not_found for a missing row — no fact', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const assignment = makeAssignment()

    await expect(
      store.unassignStaff({
        assignmentId: assignment.id,
        organizationId: ORG_ID,
        event: unassignedEvent(assignment),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isStaffError(e) && e.code === 'assignment_not_found',
    )

    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('updatePortals commits the whole diff + every fact in ONE transaction', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const existing = makeAssignment({ portalId: PORTAL_A })
    await store.assignStaff({ assignment: existing, event: assignedEvent(existing) })

    const created = makeAssignment({ portalId: PORTAL_B })
    await store.updatePortals({
      creates: [{ assignment: created, event: assignedEvent(created) }],
      removals: [
        {
          assignmentId: existing.id,
          organizationId: ORG_ID,
          event: unassignedEvent(existing),
        },
      ],
    })

    const live = await pool.query(
      'SELECT id FROM staff_assignments WHERE organization_id = $1 AND deleted_at IS NULL',
      [ORG_ID],
    )
    expect(live.rows).toHaveLength(1)
    expect(live.rows[0].id).toBe(created.id as string)
    const facts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [ORG_ID],
    )
    expect(facts.rows).toEqual([
      { event_type: 'staff.assigned', n: 2 },
      { event_type: 'staff.unassigned', n: 1 },
    ])
  })

  it('updatePortals rolls back the whole diff when one fact insert fails', async () => {
    const store = createAtomicStaffCommandStore(db, silentEvents)
    const existing = makeAssignment({ portalId: PORTAL_A })
    await store.assignStaff({ assignment: existing, event: assignedEvent(existing) })

    const created = makeAssignment({ portalId: PORTAL_B })
    const ghostRemoval = {
      ...unassignedEvent(existing),
      _tag: 'staff.ghost',
    } as unknown as Parameters<typeof store.updatePortals>[0]['removals'][number]['event']

    await expect(
      store.updatePortals({
        creates: [{ assignment: created, event: assignedEvent(created) }],
        removals: [
          { assignmentId: existing.id, organizationId: ORG_ID, event: ghostRemoval },
        ],
      }),
    ).rejects.toThrow()

    // The create rolled back AND the soft-delete rolled back
    const rows = await pool.query(
      'SELECT id, deleted_at FROM staff_assignments WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].id).toBe(existing.id as string)
    expect(rows.rows[0].deleted_at).toBeNull()
    const facts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [ORG_ID],
    )
    // Only the initial assignStaff fact remains
    expect(facts.rows).toEqual([{ event_type: 'staff.assigned', n: 1 }])
  })
})
