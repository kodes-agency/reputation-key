// Staff context — remove staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffAssignmentId } from '../../domain/types'
import { canForContext } from '#/shared/domain/permissions'
import { staffError } from '../../domain/errors'
import { staffUnassigned } from '../../domain/events'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

// ── Input type ────────────────────────────────────────────────────────────

export type RemoveStaffAssignmentInput = Readonly<{
  assignmentId: StaffAssignmentId
}>

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const removeStaffAssignment =
  (deps: RemoveStaffAssignmentDeps) =>
  async (input: RemoveStaffAssignmentInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'staff_assignment.delete')) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    // 2. Load existing
    const assignment = await deps.assignmentRepo.findById(
      ctx.organizationId,
      input.assignmentId,
    )
    if (!assignment) {
      throw staffError('assignment_not_found', 'assignment not found')
    }

    // 5. Persist
    await deps.assignmentRepo.softDelete(ctx.organizationId, assignment.id)

    // 6. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      staffUnassigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        portalId: assignment.portalId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignment = ReturnType<typeof removeStaffAssignment>
