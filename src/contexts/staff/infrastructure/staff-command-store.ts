// Atomic staff command store (BQC-3.5).
//
// One PostgreSQL transaction per command: staff_assignments state mutation +
// outbox_events insert. After commit: in-process EventBus emit for
// expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row(s) — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use cases could lose the fact between the repo write and
//   the separate fact record, and updateStaffPortals could split a diff
//   mid-loop).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - A duplicate assignment or a vanished soft-delete target records NO fact
//   and emits nothing (assignStaff/unassignStaff throw; updatePortals
//   removals no-op like the repo's softDelete did).

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import { staffError } from '../domain/errors'
import { staffAssignmentToRow } from './mappers/staff-assignment.mapper'
import type {
  AssignStaffCommand,
  StaffCommandStore,
  UnassignStaffCommand,
  UpdatePortalsCommand,
} from '../application/ports/staff-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

async function insertAssignment(tx: Tx, command: AssignStaffCommand): Promise<void> {
  await tx.insert(staffAssignments).values(staffAssignmentToRow(command.assignment))
  await insertOutboxRow(tx, command.event)
}

async function softDeleteAssignment(
  tx: Tx,
  command: UnassignStaffCommand,
): Promise<void> {
  const now = new Date()
  await tx
    .update(staffAssignments)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(staffAssignments.organizationId, unbrand(command.organizationId)),
        eq(staffAssignments.id, unbrand(command.assignmentId)),
        isNull(staffAssignments.deletedAt),
      ),
    )
  await insertOutboxRow(tx, command.event)
}

export function createAtomicStaffCommandStore(
  db: Database,
  events: EventBus,
): StaffCommandStore {
  return {
    assignStaff: async (command: AssignStaffCommand) => {
      return trace('staff.commandStore.assignStaff', async () => {
        await db.transaction(async (tx) => {
          // Uniqueness guard — the friendly already_assigned error. The
          // partial unique indexes remain the authoritative race backstop.
          const conditions = [
            eq(
              staffAssignments.organizationId,
              unbrand(command.assignment.organizationId),
            ),
            eq(staffAssignments.userId, unbrand(command.assignment.userId)),
            eq(staffAssignments.propertyId, unbrand(command.assignment.propertyId)),
            command.assignment.teamId
              ? eq(staffAssignments.teamId, unbrand(command.assignment.teamId))
              : isNull(staffAssignments.teamId),
            command.assignment.portalId
              ? eq(staffAssignments.portalId, unbrand(command.assignment.portalId))
              : isNull(staffAssignments.portalId),
            isNull(staffAssignments.deletedAt),
          ]
          const existing = await tx
            .select({ id: staffAssignments.id })
            .from(staffAssignments)
            .where(and(...conditions))
            .limit(1)
          if (existing.length > 0) {
            throw staffError(
              'already_assigned',
              'this user is already assigned to this property/team/portal',
            )
          }
          await insertAssignment(tx, command)
        })
        await emitAfterCommit(events, command.event)
        return command.assignment
      })
    },

    unassignStaff: async (command: UnassignStaffCommand) => {
      return trace('staff.commandStore.unassignStaff', async () => {
        await db.transaction(async (tx) => {
          const now = new Date()
          const updated = await tx
            .update(staffAssignments)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                eq(staffAssignments.organizationId, unbrand(command.organizationId)),
                eq(staffAssignments.id, unbrand(command.assignmentId)),
                isNull(staffAssignments.deletedAt),
              ),
            )
            .returning({ id: staffAssignments.id })
          if (!updated[0]) {
            throw staffError('assignment_not_found', 'assignment not found')
          }
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    updatePortals: async (command: UpdatePortalsCommand) => {
      return trace('staff.commandStore.updatePortals', async () => {
        await db.transaction(async (tx) => {
          for (const create of command.creates) await insertAssignment(tx, create)
          for (const removal of command.removals) await softDeleteAssignment(tx, removal)
        })
        for (const create of command.creates) await emitAfterCommit(events, create.event)
        for (const removal of command.removals) {
          await emitAfterCommit(events, removal.event)
        }
      })
    },
  }
}
