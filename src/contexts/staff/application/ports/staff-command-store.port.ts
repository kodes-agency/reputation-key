// Staff command store — atomic staff-assignment state mutation + outbox
// record (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the staff_assignments state write
// and the outbox_events fact in ONE PostgreSQL transaction, then emits on
// the in-process bus after commit (expand-phase dual path until the
// durable switch).

import type { OrganizationId } from '#/shared/domain/ids'
import type { StaffAssignment, StaffAssignmentId } from '../../domain/types'
import type { StaffAssigned, StaffUnassigned } from '../../domain/events'

/**
 * Assignment insert + staff.assigned fact in one transaction. Throws
 * `already_assigned` when a live row already covers the same
 * (org, user, property, team, portal) — records NO fact.
 */
export type AssignStaffCommand = Readonly<{
  assignment: StaffAssignment
  event: StaffAssigned
}>

/**
 * Soft-delete + staff.unassigned fact in one transaction. Throws
 * `assignment_not_found` when no live row matches (id + organizationId) —
 * records NO fact.
 */
export type UnassignStaffCommand = Readonly<{
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  event: StaffUnassigned
}>

/**
 * Portal-set reconciliation: ALL creates + ALL removals + every fact in ONE
 * transaction (the pre-BQC-3.5 loop could split rows from their facts mid-
 * diff). Post-commit emits preserve loop order (creates, then removals).
 */
export type UpdatePortalsCommand = Readonly<{
  creates: ReadonlyArray<AssignStaffCommand>
  removals: ReadonlyArray<UnassignStaffCommand>
}>

export type StaffCommandStore = Readonly<{
  assignStaff(command: AssignStaffCommand): Promise<StaffAssignment>
  unassignStaff(command: UnassignStaffCommand): Promise<void>
  updatePortals(command: UpdatePortalsCommand): Promise<void>
}>
