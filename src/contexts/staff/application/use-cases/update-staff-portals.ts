// Staff context — update staff portals use case
// Replaces all portal assignments for a user in a property with the given set.
// Diff current vs new → creates missing, removes extra.
// BQC-3.5: the whole diff (creates + removals + every fact) commits in ONE
// transaction via the command store — the pre-BQC-3.5 loop could split rows
// from their facts mid-diff.

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { StaffCommandStore } from '../ports/staff-command-store.port'
import type {
  AssignStaffCommand,
  UnassignStaffCommand,
} from '../ports/staff-command-store.port'
import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UserId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { StaffAssignment } from '../../domain/types'
import type { StaffPublicApi } from '../public-api'
import { canForContext } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { staffError } from '../../domain/errors'
import { staffAssigned, staffUnassigned } from '../../domain/events'
import { buildStaffAssignment } from '../../domain/constructors'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { staffAssignmentId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type UpdateStaffPortalsInput = Readonly<{
  userId: UserId
  propertyId: PropertyId
  portalIds: ReadonlyArray<PortalId>
}>

// fallow-ignore-next-line unused-type
export type UpdateStaffPortalsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  portalLookup: StaffPortalLookupPort
  commandStore: StaffCommandStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
  idGen: () => string
}>

/** Build the create command for one missing portal assignment (+ its fact). */
function buildCreateCommand(
  deps: UpdateStaffPortalsDeps,
  input: UpdateStaffPortalsInput,
  ctx: AuthContext,
  teamId: StaffAssignment['teamId'],
  pId: PortalId,
  correlationId: string,
): AssignStaffCommand {
  const buildResult = buildStaffAssignment({
    id: staffAssignmentId(deps.idGen()),
    organizationId: ctx.organizationId,
    userId: input.userId,
    propertyId: input.propertyId,
    teamId,
    portalId: pId,
    actingUserId: hasRole(ctx.role, 'AccountAdmin') ? undefined : ctx.userId,
    now: deps.clock(),
  })

  if (buildResult.isErr()) {
    throw staffError(buildResult.error.code, buildResult.error.message)
  }

  const assignment = buildResult.value
  return {
    assignment,
    event: {
      ...staffAssigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        teamId: assignment.teamId,
        portalId: assignment.portalId,
        occurredAt: assignment.createdAt,
      }),
      correlationId,
    },
  }
}

/**
 * Diff current vs desired portal assignments: creates for missing portals
 * (team from the first row — all rows share the same team), removals for
 * portals no longer desired. Every command carries its fact with the shared
 * correlationId.
 */
function buildPortalDiff(
  deps: UpdateStaffPortalsDeps,
  input: UpdateStaffPortalsInput,
  ctx: AuthContext,
  current: ReadonlyArray<StaffAssignment>,
  correlationId: string,
): { creates: AssignStaffCommand[]; removals: UnassignStaffCommand[] } {
  // Build lookup: portalId → assignment
  const currentByPortal: Map<PortalId, StaffAssignment> = new Map(
    current
      .filter((a): a is StaffAssignment & { portalId: PortalId } => a.portalId != null)
      .map((a) => [a.portalId, a] as const),
  )
  const currentPortalIds = new Set(currentByPortal.keys())
  const teamId = current[0]?.teamId ?? null
  const desiredSet = new Set(input.portalIds)

  const creates: AssignStaffCommand[] = []
  const removals: UnassignStaffCommand[] = []

  for (const pId of input.portalIds) {
    if (!currentPortalIds.has(pId)) {
      creates.push(buildCreateCommand(deps, input, ctx, teamId, pId, correlationId))
    }
  }

  for (const [portalId, assignment] of currentByPortal) {
    if (!desiredSet.has(portalId)) {
      removals.push({
        assignmentId: assignment.id,
        organizationId: ctx.organizationId,
        event: {
          ...staffUnassigned({
            assignmentId: assignment.id,
            organizationId: assignment.organizationId,
            userId: assignment.userId,
            propertyId: assignment.propertyId,
            portalId: assignment.portalId,
            occurredAt: deps.clock(),
          }),
          correlationId,
        },
      })
    }
  }

  return { creates, removals }
}

export const updateStaffPortals =
  (deps: UpdateStaffPortalsDeps) =>
  async (
    input: UpdateStaffPortalsInput,
    ctx: AuthContext,
  ): Promise<{ added: number; removed: number }> => {
    // 1. Authorize — update is create + delete combined
    if (
      !canForContext(ctx, 'staff_assignment.create') ||
      !canForContext(ctx, 'staff_assignment.delete')
    ) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    // 1b. Property-access scoping (D6-001):
    // AccountAdmin bypasses; PropertyManager/Staff must be assigned to the target property.
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, userId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'staff_assignment.create',
      input.propertyId,
    )
    if (!accessible) {
      throw staffError('forbidden', 'no access to this property')
    }

    const correlationId = deps.idGen()

    // 2. Validate — all requested portalIds must belong to the property
    const validPortalIds = new Set(
      await deps.portalLookup.listPortalIdsByProperty(
        ctx.organizationId,
        input.propertyId,
      ),
    )
    const invalidPortalIds = input.portalIds.filter((id) => !validPortalIds.has(id))
    if (invalidPortalIds.length > 0) {
      throw staffError(
        'invalid_input',
        `Portals not in property: ${invalidPortalIds.join(', ')}`,
      )
    }

    // 3. Load current assignments for this user in this property
    const current = await deps.assignmentRepo.listByUserAndProperty(
      ctx.organizationId,
      input.userId,
      input.propertyId,
    )

    // 4. Diff + apply the whole change set + every fact in ONE transaction
    const { creates, removals } = buildPortalDiff(
      deps,
      input,
      ctx,
      current,
      correlationId,
    )
    await deps.commandStore.updatePortals({ creates, removals })

    return { added: creates.length, removed: removals.length }
  }

export type UpdateStaffPortalsResult = Readonly<{ added: number; removed: number }>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type UpdateStaffPortals = (
  input: UpdateStaffPortalsInput,
  ctx: AuthContext,
) => Promise<UpdateStaffPortalsResult>
