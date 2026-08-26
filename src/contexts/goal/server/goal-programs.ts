import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../application/use-cases/governed-goals'
import {
  GoalProgramError,
  type GoalProgramService,
} from '../application/use-cases/goal-programs'
import type { GoalProgramBundle, GoalSubject } from '../application/public-api'
import { canForContext } from '#/shared/domain/permissions'

const uuid = z.uuid()
const metricSchema = z.enum([
  'qualified_scans',
  'portal_rating_count',
  'portal_rating_average',
])
const subjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property'), propertyId: uuid }),
  z.object({ kind: z.literal('portal_group'), portalGroupId: uuid }),
  z.object({ kind: z.literal('portal'), portalId: uuid }),
])

export const createGoalProgramSchema = z.object({
  propertyId: uuid,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  metric: metricSchema,
  targetValue: z.number().finite(),
  subjects: z.array(subjectSchema).min(1).max(250),
})

export const reviseGoalProgramSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  metric: metricSchema,
  targetValue: z.number().finite(),
  subjects: z.array(subjectSchema).min(1).max(250),
  reason: z.string().trim().min(1).max(500),
})

export const changeGoalProgramStatusSchema = z.object({
  propertyId: uuid,
  programId: uuid,
  status: z.enum(['scheduled', 'active', 'paused', 'ended']),
  reason: z.string().trim().min(1).max(500),
})

const goalProgramIdentitySchema = z.object({ propertyId: uuid, programId: uuid })
const listGoalProgramsSchema = z.object({ propertyId: uuid })

export function scopeGoalProgramsForStaff<
  Assignment extends Readonly<{ id: string; subject: GoalSubject }>,
  Result extends Readonly<{ assignmentId: string }>,
  Program extends Readonly<{
    assignments: readonly Assignment[]
    results: readonly Result[]
  }>,
>(
  programs: readonly Program[],
  visiblePortalIds: readonly string[],
  visibleGroupIds: readonly string[],
): Array<
  Program &
    Readonly<{
      assignments: readonly Assignment[]
      results: readonly Result[]
    }>
> {
  const portalSet = new Set(visiblePortalIds)
  const groupSet = new Set(visibleGroupIds)
  return programs.flatMap((bundle) => {
    const assignments = bundle.assignments.filter(({ subject }) => {
      if (subject.kind === 'property') return true
      if (subject.kind === 'portal') return portalSet.has(subject.portalId)
      return groupSet.has(subject.portalGroupId)
    })
    if (assignments.length === 0) return []
    const assignmentIds = new Set(assignments.map(({ id }) => id))
    return [
      {
        ...bundle,
        assignments,
        results: bundle.results.filter(({ assignmentId }) =>
          assignmentIds.has(assignmentId),
        ),
      },
    ]
  })
}

async function scopeProgramsForRequest(
  programs: readonly GoalProgramBundle[],
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
  propertyId: string,
): Promise<readonly GoalProgramBundle[]> {
  if (canForContext(ctx, 'goal.create')) return programs
  const container = getContainer()
  const visiblePortalIds = await container.staffPublicApi.getAssignedPortals(
    { userId: ctx.userId, propertyId: toPropertyId(propertyId) },
    ctx,
  )
  const visibleGroupIds =
    await container.portalPublicApi.portalGroup.findGroupIdsByPortalIds(
      ctx.organizationId,
      visiblePortalIds,
    )
  return scopeGoalProgramsForStaff(programs, visiblePortalIds, visibleGroupIds)
}

const requestActor = (ctx: Awaited<ReturnType<typeof resolveTenantContext>>): GoalActor =>
  ctx

const requestPolicy = (
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
): GoalExecutionPolicy => ({
  authorize: async (request) => {
    if (
      request.actor === 'system' ||
      request.organizationId !== ctx.organizationId ||
      request.actor.userId !== ctx.userId
    ) {
      throw new GoalProgramError('forbidden')
    }
    await requireExecutionAllowed({
      actor: ctx,
      action: request.action,
      capability: 'goal.use',
      propertyId: request.propertyId,
    })
  },
})

const goalProgramStatus = (error: GoalProgramError): number => {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'invalid_transition':
    case 'revision_conflict':
    case 'metric_unavailable':
      return 409
    case 'invalid_name':
    case 'invalid_target':
    case 'invalid_subject':
    case 'duplicate_subject':
      return 400
  }
}

async function withGoalProgramService<T>(
  run: (
    service: GoalProgramService,
    actor: GoalActor,
    ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  const service = getContainer().useCases.createGoalProgramService(requestPolicy(ctx))
  try {
    return await run(service, requestActor(ctx), ctx)
  } catch (error) {
    if (error instanceof GoalProgramError) {
      throwContextError('GoalProgramError', error, goalProgramStatus(error))
    }
    throw catchUntagged(error)
  }
}

export const createGoalProgram = createServerFn({ method: 'POST' })
  .validator(createGoalProgramSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalProgramService((service, actor) => service.create(data, actor)),
      'POST',
      'goal.createGoalProgram',
    ),
  )

export const reviseGoalProgram = createServerFn({ method: 'POST' })
  .validator(reviseGoalProgramSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalProgramService((service, actor) => service.revise(data, actor)),
      'POST',
      'goal.reviseGoalProgram',
    ),
  )

export const changeGoalProgramStatus = createServerFn({ method: 'POST' })
  .validator(changeGoalProgramStatusSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalProgramService((service, actor) => service.changeStatus(data, actor)),
      'POST',
      'goal.changeGoalProgramStatus',
    ),
  )

export const getGoalProgram = createServerFn({ method: 'GET' })
  .validator(goalProgramIdentitySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalProgramService(async (service, actor, ctx) => {
          const program = await service.get(data, actor)
          const [visible] = await scopeProgramsForRequest([program], ctx, data.propertyId)
          if (!visible) throw new GoalProgramError('not_found')
          return visible
        }),
      'GET',
      'goal.getGoalProgram',
    ),
  )

export const listGoalPrograms = createServerFn({ method: 'GET' })
  .validator(listGoalProgramsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalProgramService(async (service, actor, ctx) => {
          const programs = await service.list(data.propertyId, actor)
          return {
            programs: await scopeProgramsForRequest(programs, ctx, data.propertyId),
          }
        }),
      'GET',
      'goal.listGoalPrograms',
    ),
  )
