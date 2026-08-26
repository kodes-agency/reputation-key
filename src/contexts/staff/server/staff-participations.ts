import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isStaffError } from '../application/public-api'
import { staffErrorStatus } from './staff-shared'

const createInput = z.object({
  propertyId: z.uuid(),
  displayName: z.string().trim().min(1).max(255),
})

const listInput = z.object({
  propertyId: z.uuid().optional(),
  userId: z.string().min(1).max(255).optional(),
  activeOnly: z.boolean().optional().default(false),
})

const archiveInput = z.object({
  staffParticipationId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  expectedRevision: z.number().int().positive(),
})

const responsibilitiesInput = z.object({
  staffParticipationId: z.uuid(),
  primaryPortalId: z.uuid().nullable(),
  supportingPortalIds: z.array(z.uuid()).max(500),
  expectedRevision: z.number().int().positive(),
})

function rethrow(error: unknown): never {
  if (isStaffError(error)) {
    throwContextError('StaffError', error, staffErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

export const createStaffParticipation = createServerFn({ method: 'POST' })
  .validator(createInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.manage',
          propertyId: data.propertyId,
        })
        try {
          const participation = await getContainer().useCases.createStaffParticipation(
            data,
            ctx,
          )
          return { participation }
        } catch (error) {
          rethrow(error)
        }
      },
      'POST',
      'staff.createStaffParticipation',
    ),
  )

export const listStaffParticipations = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.read',
          ...(data.propertyId ? { propertyId: data.propertyId } : {}),
        })
        try {
          return await getContainer().useCases.listStaffParticipations(data, ctx)
        } catch (error) {
          rethrow(error)
        }
      },
      'GET',
      'staff.listStaffParticipations',
    ),
  )

export const archiveStaffParticipation = createServerFn({ method: 'POST' })
  .validator(archiveInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'staff.manage' })
        try {
          const participation = await getContainer().useCases.archiveStaffParticipation(
            data,
            ctx,
          )
          return { participation }
        } catch (error) {
          rethrow(error)
        }
      },
      'POST',
      'staff.archiveStaffParticipation',
    ),
  )

export const updatePortalResponsibilities = createServerFn({ method: 'POST' })
  .validator(responsibilitiesInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'staff.manage' })
        try {
          const result = await getContainer().useCases.updatePortalResponsibilities(
            data,
            ctx,
          )
          return result
        } catch (error) {
          rethrow(error)
        }
      },
      'POST',
      'staff.updatePortalResponsibilities',
    ),
  )
