// Staff context — create staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffAssignment, StaffAssignmentId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
import type { RandomBytesFn } from '../../domain/referral-code'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { buildStaffAssignment } from '../../domain/constructors'
import { staffError } from '../../domain/errors'
import { staffAssigned } from '../../domain/events'
import { generateReferralCode } from '../../domain/referral-code'
import {
  userId as toUserId,
  propertyId as toPropertyId,
  teamId as toTeamId,
} from '#/shared/domain/ids'

/** PostgreSQL error code for unique constraint violation */
const PG_UNIQUE_VIOLATION = '23505'

const MAX_REFERRAL_CODE_ATTEMPTS = 3

/** Check if an error is a PostgreSQL unique_violation (error code 23505) */
const isUniqueViolation = (e: unknown): boolean => {
  if (typeof e === 'object' && e !== null) {
    const err = e as { code?: string; driverError?: { code?: string } }
    return (
      err.code === PG_UNIQUE_VIOLATION || err.driverError?.code === PG_UNIQUE_VIOLATION
    )
  }
  return false
}

// fallow-ignore-next-line unused-type
export type CreateStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  idGen: () => StaffAssignmentId
  clock: () => Date
  randomBytesFn: RandomBytesFn
}>

export const createStaffAssignment =
  (deps: CreateStaffAssignmentDeps) =>
  async (
    input: CreateStaffAssignmentInput,
    ctx: AuthContext,
  ): Promise<StaffAssignment> => {
    // 1. Authorize
    if (!can(ctx.role, 'staff_assignment.create')) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    const userId = toUserId(input.userId)
    const propertyId = toPropertyId(input.propertyId)
    const teamId = input.teamId != null ? toTeamId(input.teamId) : null

    // 2. Self-assignment guard — only Staff role is blocked
    if (userId === ctx.userId && !hasRole(ctx.role, 'PropertyManager')) {
      throw staffError('invalid_input', 'Cannot assign yourself to a property')
    }

    // 3. Check uniqueness — prevent duplicate assignments
    if (
      await deps.assignmentRepo.assignmentExists(
        ctx.organizationId,
        userId,
        propertyId,
        teamId,
      )
    ) {
      throw staffError(
        'already_assigned',
        'this user is already assigned to this property/team',
      )
    }

    // 4. Build domain object (initially without referral code)
    const buildResult = buildStaffAssignment({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      userId,
      propertyId,
      teamId,
      now: deps.clock(),
    })

    if (buildResult.isErr()) {
      throw staffError(buildResult.error.code, buildResult.error.message)
    }

    const baseAssignment = buildResult.value

    // 5. Generate referral code with collision retry
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_REFERRAL_CODE_ATTEMPTS; attempt++) {
      const referralCode = generateReferralCode(userId, deps.randomBytesFn)
      const assignment: StaffAssignment = { ...baseAssignment, referralCode }

      try {
        await deps.assignmentRepo.insert(ctx.organizationId, assignment)

        // 6. Emit event
        await deps.events.emit(
          staffAssigned({
            assignmentId: assignment.id,
            organizationId: assignment.organizationId,
            userId: assignment.userId,
            propertyId: assignment.propertyId,
            teamId: assignment.teamId,
            occurredAt: assignment.createdAt,
          }),
        )

        // 7. Return
        return assignment
      } catch (e) {
        if (isUniqueViolation(e)) {
          lastError = e
          continue
        }
        throw e
      }
    }

    throw staffError(
      'referral_code_collision',
      `failed to generate a unique referral code after ${MAX_REFERRAL_CODE_ATTEMPTS} attempts`,
      { cause: lastError },
    )
  }

// fallow-ignore-next-line unused-type
export type CreateStaffAssignment = ReturnType<typeof createStaffAssignment>
