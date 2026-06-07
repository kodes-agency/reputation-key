// Staff context — server functions

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { HTTP_STATUS } from '#/shared/auth/error-status'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { portalId as toPortalId } from '#/shared/domain/ids'
import {
  createStaffAssignmentInputSchema,
  removeStaffAssignmentInputSchema,
  listStaffAssignmentsInputSchema,
} from '../application/dto/staff-assignment.dto'
import { isStaffError } from '../application/public-api'
import type { StaffErrorCode } from '../application/public-api'
import {
  staffAssignmentId as toStaffAssignmentId,
  propertyId as toPropertyId,
  userId as toUserId,
  teamId as toTeamId,
} from '#/shared/domain/ids'

const staffErrorStatus = (code: StaffErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'assignment_not_found',
      'property_not_found',
      'team_not_found',
      () => HTTP_STATUS.NOT_FOUND,
    )
    .with('already_assigned', () => HTTP_STATUS.CONFLICT)
    .with('invalid_input', () => HTTP_STATUS.BAD_REQUEST)
    .exhaustive()

// ── createStaffAssignment ──────────────────────────────────────────

export const createStaffAssignment = createServerFn({ method: 'POST' })
  .inputValidator(createStaffAssignmentInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

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

// ── updateStaffPortals ─────────────────────────────────────────────

const updateStaffPortalsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  portalIds: z.array(z.string()).min(1, 'Select at least one portal'),
})

export const updateStaffPortals = createServerFn({ method: 'POST' })
  .inputValidator(updateStaffPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        // Validate portalIds belong to the property
        const container = getContainer()
        const propertyPortals = await container.portalRepo.listByProperty(
          ctx.organizationId,
          data.propertyId,
        )
        const validPortalIds = new Set(propertyPortals.map((p) => p.id))
        const invalidPortalIds = data.portalIds
          .map((id) => toPortalId(id))
          .filter((id) => !validPortalIds.has(id))
        if (invalidPortalIds.length > 0) {
          throwContextError(
            'StaffError',
            {
              code: 'invalid_input',
              message: `Portals not in property: ${invalidPortalIds.join(', ')}`,
            },
            HTTP_STATUS.BAD_REQUEST,
          )
        }

        try {
          const { useCases } = container
          const result = await useCases.updateStaffPortals(
            {
              userId: toUserId(data.userId),
              propertyId: toPropertyId(data.propertyId),
              portalIds: data.portalIds.map((id) => toPortalId(id)),
            },
            ctx,
          )
          return result
        } catch (e) {
          if (isStaffError(e))
            throwContextError('StaffError', e, staffErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'staff.updateStaffPortals',
    ),
  )
