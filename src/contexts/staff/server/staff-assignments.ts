// Staff context — server functions

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { staffErrorStatus } from './staff-shared'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createStaffAssignmentInputSchema,
  removeStaffAssignmentInputSchema,
  listStaffAssignmentsInputSchema,
} from '../application/dto/staff-assignment.dto'
import { isStaffError } from '../application/public-api'
import {
  staffAssignmentId as toStaffAssignmentId,
  propertyId as toPropertyId,
  userId as toUserId,
  teamId as toTeamId,
} from '#/shared/domain/ids'

// ── createStaffAssignment ──────────────────────────────────────────

export const createStaffAssignment = createServerFn({ method: 'POST' })
  .inputValidator(createStaffAssignmentInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff_assignment.create',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          const assignment = await useCases.createStaffAssignment(data, ctx)
          return { assignment }
        } catch (e) {
          if (isStaffError(e))
            throwContextError('StaffError', e, staffErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'staff.createStaffAssignment',
    ),
  )

// ── removeStaffAssignment ──────────────────────────────────────────

export const removeStaffAssignment = createServerFn({ method: 'POST' })
  .inputValidator(removeStaffAssignmentInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'staff_assignment.delete' })

        try {
          const { useCases } = getContainer()
          await useCases.removeStaffAssignment(
            { assignmentId: toStaffAssignmentId(data.assignmentId) },
            ctx,
          )
          return { removed: true, assignmentId: data.assignmentId }
        } catch (e) {
          if (isStaffError(e))
            throwContextError('StaffError', e, staffErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'staff.removeStaffAssignment',
    ),
  )

// ── listStaffAssignments ───────────────────────────────────────────

export const listStaffAssignments = createServerFn({ method: 'GET' })
  .inputValidator(listStaffAssignmentsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff_assignment.read',
          propertyId: data.propertyId,
        })

        try {
          const { useCases } = getContainer()
          const assignments = await useCases.listStaffAssignments(
            {
              propertyId:
                data.propertyId != null ? toPropertyId(data.propertyId) : undefined,
              userId: data.userId != null ? toUserId(data.userId) : undefined,
              teamId: data.teamId != null ? toTeamId(data.teamId) : undefined,
            },
            ctx,
          )
          return { assignments }
        } catch (e) {
          if (isStaffError(e))
            throwContextError('StaffError', e, staffErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'staff.listStaffAssignments',
    ),
  )

// ── Re-exports from split files ────────────────────────────────────

export { updateStaffPortals } from './staff-portals-update'
