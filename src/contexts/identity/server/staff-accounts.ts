import { rethrowStaffAccount } from './staff-account-errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const plan = {
  propertyId: z.uuid(),
  sourcePortalId: z.uuid().optional(),
  portalGroupId: z.uuid().optional(),
}
const row = z
  .object({ email: z.string().max(320), displayName: z.string().max(100) })
  .strict()
const participation = z.object({ participationId: z.uuid() }).strict()

export const checkStaffBatch = createServerFn({ method: 'POST' })
  .validator(z.object({ ...plan, rows: z.array(row).min(1).max(20) }).strict())
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = data.propertyId
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.invite',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.checkStaffBatch(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.checkStaffBatch',
    ),
  )

export const addStaffMember = createServerFn({ method: 'POST' })
  .validator(z.object({ ...plan, ...row.shape, operationId: z.uuid() }).strict())
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = data.propertyId
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.invite',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.addStaffMember(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.addStaffMember',
    ),
  )

export const resendStaffInvitation = createServerFn({ method: 'POST' })
  .validator(participation)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = await api.propertyForParticipation(data.participationId, ctx)
        if (!propertyId)
          throwContextError(
            'StaffAccountError',
            { code: 'participation_not_found', message: 'Staff member not found' },
            404,
          )
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.invite',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.resendStaffInvitation(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.resendStaffInvitation',
    ),
  )

export const removeStaffMember = createServerFn({ method: 'POST' })
  .validator(participation)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = await api.propertyForParticipation(data.participationId, ctx)
        if (!propertyId)
          throwContextError(
            'StaffAccountError',
            { code: 'participation_not_found', message: 'Staff member not found' },
            404,
          )
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.remove',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.removeStaffMember(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.removeStaffMember',
    ),
  )

export const renameStaffMember = createServerFn({ method: 'POST' })
  .validator(
    participation.extend({ displayName: z.string().trim().min(1).max(100) }).strict(),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = await api.propertyForParticipation(data.participationId, ctx)
        if (!propertyId)
          throwContextError(
            'StaffAccountError',
            { code: 'participation_not_found', message: 'Staff member not found' },
            404,
          )
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.invite',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.renameStaffMember(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.renameStaffMember',
    ),
  )

export const listStaffMembers = createServerFn({ method: 'GET' })
  .validator(z.object({ propertyId: z.uuid() }).strict())
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = data.propertyId
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.read',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.listStaffMembers(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'GET',
      'identity.listStaffMembers',
    ),
  )

export const setColleagueListEnabled = createServerFn({ method: 'POST' })
  .validator(z.object({ propertyId: z.uuid(), enabled: z.boolean() }).strict())
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        const api = getContainer().identityPublicApi.staffAccounts
        const propertyId = data.propertyId
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff.settings',
          capability: 'staff.accounts',
          propertyId,
        })
        try {
          return await api.setColleagueListEnabled(data, ctx)
        } catch (error) {
          rethrowStaffAccount(error)
        }
      },
      'POST',
      'identity.setColleagueListEnabled',
    ),
  )
