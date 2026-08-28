import { createServerFn } from '@tanstack/react-start'
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
} from '../application/ports/goal-execution-policy'
import { GoalProgramError } from '../application/use-cases/goal-programs'
import {
  changeGoalProgramAssignmentsSchema,
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
  goalProgramIdentitySchema,
  listGoalProgramsSchema,
  reviseGoalProgramSchema,
} from '../application/dto/goal-program.dto'
export {
  changeGoalProgramAssignmentsSchema,
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
  reviseGoalProgramSchema,
} from '../application/dto/goal-program.dto'
import type {
  GoalProgramBundle,
  GoalProgramRequestApi,
  GoalSubject,
} from '../application/public-api'
import { canForContext } from '#/shared/domain/permissions'

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
    case 'assignment_limit_exceeded':
    case 'invalid_reason':
      return 400
  }
}

async function withGoalPrograms<T>(
  run: (
    programs: GoalProgramRequestApi,
    policy: GoalExecutionPolicy,
    actor: GoalActor,
    ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  const programs = getContainer().goalPublicApi.programs
  const policy = requestPolicy(ctx)
  try {
    return await run(programs, policy, requestActor(ctx), ctx)
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
        withGoalPrograms((programs, policy, actor) =>
          programs.create(policy, data, actor),
        ),
      'POST',
      'goal.createGoalProgram',
    ),
  )

export const reviseGoalProgram = createServerFn({ method: 'POST' })
  .validator(reviseGoalProgramSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.revise(policy, data, actor),
        ),
      'POST',
      'goal.reviseGoalProgram',
    ),
  )

export const changeGoalProgramAssignments = createServerFn({ method: 'POST' })
  .validator(changeGoalProgramAssignmentsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.changeAssignments(policy, data, actor),
        ),
      'POST',
      'goal.changeGoalProgramAssignments',
    ),
  )

export const changeGoalProgramStatus = createServerFn({ method: 'POST' })
  .validator(changeGoalProgramStatusSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.changeStatus(policy, data, actor),
        ),
      'POST',
      'goal.changeGoalProgramStatus',
    ),
  )

export const getGoalProgram = createServerFn({ method: 'GET' })
  .validator(goalProgramIdentitySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor, ctx) => {
          const program = await programs.get(policy, data, actor)
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
        withGoalPrograms(async (programApi, policy, actor, ctx) => {
          const programs = await programApi.list(policy, data.propertyId, actor)
          return {
            programs: await scopeProgramsForRequest(programs, ctx, data.propertyId),
          }
        }),
      'GET',
      'goal.listGoalPrograms',
    ),
  )
