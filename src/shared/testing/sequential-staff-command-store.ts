// Sequential staff command store — NON-transactional test/Storybook fake
// (BQC-3.5). Lives in shared/testing (with the in-memory staff repo) so
// application-zone tests and browser bundles can use it without importing
// the drizzle-backed atomic store (application must not import
// infrastructure). Applies the same operation order (state → outbox → emit)
// against the repository port without a real transaction.
//
// Not for production — production must use createAtomicStaffCommandStore
// (src/contexts/staff/infrastructure/staff-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { staffError } from '#/contexts/staff/domain/errors'
import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
import type { StaffCommandStore } from '#/contexts/staff/application/ports/staff-command-store.port'

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after sequential store state write',
    )
  }
}

export function createSequentialStaffCommandStore(deps: {
  repo: StaffAssignmentRepository
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): StaffCommandStore {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  return {
    assignStaff: async (command) => {
      const { assignment } = command
      if (
        await deps.repo.assignmentExists(
          assignment.organizationId,
          assignment.userId,
          assignment.propertyId,
          assignment.teamId,
          assignment.portalId,
        )
      ) {
        throw staffError(
          'already_assigned',
          'this user is already assigned to this property/team/portal',
        )
      }
      await deps.repo.insert(assignment.organizationId, assignment)
      await recordAndEmit(command.event)
      return assignment
    },

    unassignStaff: async (command) => {
      const existing = await deps.repo.findById(
        command.organizationId,
        command.assignmentId,
      )
      if (!existing) {
        throw staffError('assignment_not_found', 'assignment not found')
      }
      await deps.repo.softDelete(command.organizationId, command.assignmentId)
      await recordAndEmit(command.event)
    },

    updatePortals: async (command) => {
      for (const create of command.creates) {
        await deps.repo.insert(create.assignment.organizationId, create.assignment)
        await recordAndEmit(create.event)
      }
      for (const removal of command.removals) {
        await deps.repo.softDelete(removal.organizationId, removal.assignmentId)
        await recordAndEmit(removal.event)
      }
    },
  }
}
