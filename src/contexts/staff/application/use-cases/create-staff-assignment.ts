// Staff context — create staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { IdentityMembershipPort } from '../ports/identity-membership.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffAssignment } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
export type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
import type { StaffPublicApi } from '../public-api'
import { canForContext } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { buildStaffAssignment } from '../../domain/constructors'
import { staffError } from '../../domain/errors'
import { staffAssigned } from '../../domain/events'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import {
  userId as toUserId,
  propertyId as toPropertyId,
  teamId as toTeamId,
  portalId as toPortalId,
  staffAssignmentId,
  type OrganizationId,
  type UserId,
  type PropertyId,
  type TeamId,
  type PortalId,
} from '#/shared/domain/ids'

export type CreateStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  staffPublicApi: StaffPublicApi
  /** Membership gate (ADR 0006): the target user must belong to the acting
   *  organization before an assignment row is created, so a caller with
   *  `staff_assignment.create` cannot forge a dangling assignment for a user
   *  from another org or a non-existent id (which would pollute
   *  getAccessiblePropertyIds for that forged id). */
  identityMembership: IdentityMembershipPort
  idGen: () => string
  clock: () => Date
}>

/**
 * Deps for the privileged system path (`createStaffAssignmentSystem`).
 *
 * Deliberately omits `staffPublicApi` and `identityMembership`: the system
 * path skips property-access scoping and the membership gate by design (the
 * invitation that triggers it already authorizes both), so it must not even
 * be able to perform those checks. This keeps the privilege surface narrow.
 */
export type CreateStaffAssignmentSystemDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  idGen: () => string
  clock: () => Date
}>

/** Input for the shared persistence core (post-authorization). */
type PersistStaffAssignmentInput = {
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId: TeamId | null
  portalId: PortalId | null
  /** Self-assignment-guard input for the domain constructor. `undefined`
   *  means "no human actor" (an AccountAdmin self-assignment or a
   *  system-initiated write) and skips the guard. */
  actingUserId: UserId | undefined
}

/**
 * Shared persistence core for both entry points.
 *
 * Once an authorization decision has been made — by `createStaffAssignment`
 * via `can()` + membership + property-access scoping, or by
 * `createStaffAssignmentSystem` by design — the uniqueness check, domain
 * construction, persistence, and event emission are identical. Funneling
 * both paths through this core keeps the data-integrity guarantees from
 * drifting between the two surfaces.
 */
const persistStaffAssignment =
  (deps: {
    assignmentRepo: StaffAssignmentRepository
    events: EventBus
    idGen: () => string
    clock: () => Date
  }) =>
  async (input: PersistStaffAssignmentInput): Promise<StaffAssignment> => {
    // 1. Check uniqueness — prevent duplicate assignments
    if (
      await deps.assignmentRepo.assignmentExists(
        input.organizationId,
        input.userId,
        input.propertyId,
        input.teamId,
        input.portalId,
      )
    ) {
      throw staffError(
        'already_assigned',
        'this user is already assigned to this property/team/portal',
      )
    }

    // 2. Build domain object
    const buildResult = buildStaffAssignment({
      id: staffAssignmentId(deps.idGen()),
      organizationId: input.organizationId,
      userId: input.userId,
      propertyId: input.propertyId,
      teamId: input.teamId,
      portalId: input.portalId,
      actingUserId: input.actingUserId,
      now: deps.clock(),
    })

    if (buildResult.isErr()) {
      throw staffError(buildResult.error.code, buildResult.error.message)
    }

    const assignment = buildResult.value

    // 3. Persist
    await deps.assignmentRepo.insert(input.organizationId, assignment)

    // 4. Emit event
    await deps.events.emit(
      staffAssigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        teamId: assignment.teamId,
        portalId: assignment.portalId,
        occurredAt: assignment.createdAt,
      }),
    )

    // 5. Return
    return assignment
  }

export const createStaffAssignment =
  (deps: CreateStaffAssignmentDeps) =>
  async (
    input: CreateStaffAssignmentInput,
    ctx: AuthContext,
  ): Promise<StaffAssignment> => {
    // 1. Authorize
    if (!canForContext(ctx, 'staff_assignment.create')) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    const userId = toUserId(input.userId)
    const propertyId = toPropertyId(input.propertyId)
    const teamId = input.teamId != null ? toTeamId(input.teamId) : null
    const portalId = input.portalId != null ? toPortalId(input.portalId) : null

    // 2. Membership gate (ADR 0006): reject target users who are not members
    // of the acting organization, so a caller with `staff_assignment.create`
    // cannot create a dangling assignment for a user from another org or a
    // non-existent id (which would pollute getAccessiblePropertyIds).
    if (!(await deps.identityMembership.isMember(ctx.organizationId, userId))) {
      throw staffError(
        'invalid_input',
        'target user is not a member of this organization',
      )
    }

    // 3. Property-access scoping (D6-001):
    // AccountAdmin bypasses (getAccessiblePropertyIds returns null = all-accessible);
    // PropertyManager/Staff must be assigned to the target property.
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'staff_assignment.create',
      propertyId,
    )
    if (!accessible) {
      throw staffError('forbidden', 'no access to this property')
    }

    // 4. Self-assignment guard delegated to constructor (STAFF-01):
    // Only AccountAdmin may self-assign; PropertyManager/Staff cannot.
    const actingUserId = hasRole(ctx.role, 'AccountAdmin') ? undefined : ctx.userId

    // 5. Persist (uniqueness + build + insert + event)
    return persistStaffAssignment(deps)({
      organizationId: ctx.organizationId,
      userId,
      propertyId,
      teamId,
      portalId,
      actingUserId,
    })
  }

/**
 * Privileged system entry point — used only by the composition root for
 * bootstrap writes that are NOT user-initiated (e.g. auto-assigning a
 * property to a member on invitation acceptance).
 *
 * BY DESIGN this skips:
 *   - the `can()` permission gate (no human caller — the write is authorized
 *     by the invitation, not by a role; masquerading as AccountAdmin would be
 *     an AuthContext forgery — deep-review §9);
 *   - the membership gate (invitation acceptance is itself proof of
 *     membership, and the membership row may not be committed yet at the
 *     instant this runs — checking it here would be circular);
 *   - property-access scoping (the invitation already authorized the target
 *     property for the invitee);
 *   - the self-assignment guard (`actingUserId` is `undefined` — there is no
 *     human actor to self-assign-check against).
 *
 * Audit note: this path does NOT masquerade as an AccountAdmin. The absence
 * of an `AuthContext` and the `System` naming make the privileged write
 * explicit and grep-able. Reachable only from the composition root.
 */
export const createStaffAssignmentSystem =
  (deps: CreateStaffAssignmentSystemDeps) =>
  async (
    input: CreateStaffAssignmentInput,
    systemCtx: { organizationId: OrganizationId },
  ): Promise<StaffAssignment> =>
    persistStaffAssignment(deps)({
      organizationId: systemCtx.organizationId,
      userId: toUserId(input.userId),
      propertyId: toPropertyId(input.propertyId),
      teamId: input.teamId != null ? toTeamId(input.teamId) : null,
      portalId: input.portalId != null ? toPortalId(input.portalId) : null,
      actingUserId: undefined, // system-initiated — no human actor
    })
