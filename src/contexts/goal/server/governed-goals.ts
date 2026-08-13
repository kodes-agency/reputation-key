import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../application/use-cases/governed-goals'

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  interval: z.number().int().min(1).max(100),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  monthOfYear: z.number().int().min(1).max(12).optional(),
})

const managerActor = (
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
): GoalActor => ({
  organizationId: ctx.organizationId,
  userId: ctx.userId,
  role: ctx.role,
})

const requestPolicy = (
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
): GoalExecutionPolicy => ({
  authorize: async (request) => {
    if (
      request.actor === 'system' ||
      request.organizationId !== ctx.organizationId ||
      request.actor.userId !== ctx.userId
    ) {
      throw new Error('Forbidden')
    }
    await requireExecutionAllowed({
      actor: ctx,
      action: request.action,
      propertyId: request.propertyId,
    })
  },
})

export const createGovernedGoal = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      propertyId: z.string().uuid(),
      scope: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('property') }),
        z.object({ kind: z.literal('portal_group'), portalGroupId: z.string().uuid() }),
      ]),
      name: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2_000).nullable().optional(),
      metricDefinitionVersionId: z.string().uuid(),
      measureKind: z.enum(['progress', 'level', 'ratio']),
      targetValue: z.number().finite().positive(),
      sourcePolicy: z.string().trim().min(1).max(80),
      recurrenceRule: recurrenceSchema,
    }),
  )
  .handler(async ({ data }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    const service = getContainer().useCases.createGovernedGoalService(requestPolicy(ctx))
    return service.create(data, managerActor(ctx))
  })

export const reviseGovernedGoal = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      propertyId: z.string().uuid(),
      definitionId: z.string().uuid(),
      metricDefinitionVersionId: z.string().uuid(),
      measureKind: z.enum(['progress', 'level', 'ratio']),
      targetValue: z.number().finite().positive(),
      sourcePolicy: z.string().trim().min(1).max(80),
      recurrenceRule: recurrenceSchema,
      reason: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    const service = getContainer().useCases.createGovernedGoalService(requestPolicy(ctx))
    return service.revise(data, managerActor(ctx))
  })

export const changeGovernedGoalStatus = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      propertyId: z.string().uuid(),
      definitionId: z.string().uuid(),
      status: z.enum(['paused', 'active', 'cancelled']),
      reason: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    const service = getContainer().useCases.createGovernedGoalService(requestPolicy(ctx))
    return service.changeStatus(data, managerActor(ctx))
  })

export const getGovernedGoal = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      propertyId: z.string().uuid(),
      definitionId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    const service = getContainer().useCases.createGovernedGoalService(requestPolicy(ctx))
    return service.get(data, managerActor(ctx))
  })

export const listGovernedGoals = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      propertyId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const ctx = await resolveTenantContext(await headersFromContext())
    const container = getContainer()
    const service = container.useCases.createGovernedGoalService(requestPolicy(ctx))
    let visiblePortalGroupIds: readonly string[] | null = null
    if (ctx.role === 'Staff') {
      const portals = await container.staffPublicApi.getAssignedPortals(
        { userId: ctx.userId, propertyId: toPropertyId(data.propertyId) },
        ctx,
      )
      visiblePortalGroupIds =
        await container.portalPublicApi.portalGroup.findGroupIdsByPortalIds(
          ctx.organizationId,
          portals,
        )
    }
    return {
      goals: await service.list(
        { propertyId: data.propertyId, visiblePortalGroupIds },
        managerActor(ctx),
      ),
    }
  })
