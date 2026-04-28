// Staff context — server functions

import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createStaffAssignmentInputSchema,
  removeStaffAssignmentInputSchema,
  listStaffAssignmentsInputSchema,
} from '../application/dto/staff-assignment.dto'
import { isStaffError } from '../domain/errors'
import type { StaffErrorCode } from '../domain/errors'
import {
  staffAssignmentId as toStaffAssignmentId,
  propertyId as toPropertyId,
  userId as toUserId,
  teamId as toTeamId,
} from '#/shared/domain/ids'

const staffErrorStatus = (code: StaffErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('assignment_not_found', 'property_not_found', 'team_not_found', () => 404)
    .with('already_assigned', () => 409)
    .with('invalid_input', () => 400)
    .exhaustive()

// ── createStaffAssignment ──────────────────────────────────────────

export const createStaffAssignment = createServerFn({ method: 'POST' })
  .inputValidator(createStaffAssignmentInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const assignment = await useCases.createStaffAssignment(data, ctx)
      return { assignment }
    } catch (e) {
      if (isStaffError(e)) throwContextError('StaffError', e, staffErrorStatus(e.code))
      throw e
    }
  })

// ── removeStaffAssignment ──────────────────────────────────────────

export const removeStaffAssignment = createServerFn({ method: 'POST' })
  .inputValidator(removeStaffAssignmentInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      await useCases.removeStaffAssignment(
        { assignmentId: toStaffAssignmentId(data.assignmentId) },
        ctx,
      )
      return { removed: true, assignmentId: data.assignmentId }
    } catch (e) {
      if (isStaffError(e)) throwContextError('StaffError', e, staffErrorStatus(e.code))
      throw e
    }
  })

// ── listStaffAssignments ───────────────────────────────────────────

export const listStaffAssignments = createServerFn({ method: 'GET' })
  .inputValidator(listStaffAssignmentsInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const assignments = await useCases.listStaffAssignments(
        {
          propertyId: data.propertyId != null ? toPropertyId(data.propertyId) : undefined,
          userId: data.userId != null ? toUserId(data.userId) : undefined,
          teamId: data.teamId != null ? toTeamId(data.teamId) : undefined,
        },
        ctx,
      )
      return { assignments }
    } catch (e) {
      if (isStaffError(e)) throwContextError('StaffError', e, staffErrorStatus(e.code))
      throw e
    }
  })
