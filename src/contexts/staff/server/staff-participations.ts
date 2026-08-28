import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isStaffError } from '../application/public-api'
import { staffErrorStatus } from './staff-shared'
import {
  archiveStaffParticipationInputSchema,
  createStaffParticipationInputSchema,
  listStaffParticipationsInputSchema,
  updatePortalResponsibilitiesInputSchema,
} from '../application/dto/staff-participation.dto'

function rethrow(error: unknown): never {
  if (isStaffError(error)) {
    throwContextError('StaffError', error, staffErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

export const createStaffParticipation = createServerFn({ method: 'POST' })
  .validator(createStaffParticipationInputSchema)
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
          const participation =
            await getContainer().staffPublicApi.management.createStaffParticipation(
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
  .validator(listStaffParticipationsInputSchema)
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
          return await getContainer().staffPublicApi.management.listStaffParticipations(
            data,
            ctx,
          )
        } catch (error) {
          rethrow(error)
        }
      },
      'GET',
      'staff.listStaffParticipations',
    ),
  )

export const archiveStaffParticipation = createServerFn({ method: 'POST' })
  .validator(archiveStaffParticipationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'staff.manage' })
        try {
          const participation =
            await getContainer().staffPublicApi.management.archiveStaffParticipation(
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
  .validator(updatePortalResponsibilitiesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'staff.manage' })
        try {
          const result =
            await getContainer().staffPublicApi.management.updatePortalResponsibilities(
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
