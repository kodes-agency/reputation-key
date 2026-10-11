import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramRequestApi,
} from '../application/use-cases/goal-programs'
import type { GoalMonthPreviewRequestApi } from '../application/use-cases/goal-month-preview'
import type { GoalProgressRequestApi } from '../application/use-cases/goal-progress'
import {
  changeGoalProgramAssignmentsSchema,
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
  getGoalProgressSchema,
  goalProgramIdentitySchema,
  listGoalProgramsSchema,
  previewGoalMonthSchema,
  renameGoalProgramSchema,
  reviseGoalProgramSchema,
} from '../application/dto/goal-program.dto'
export {
  changeGoalProgramAssignmentsSchema,
  createGoalProgramSchema,
  getGoalProgressSchema,
  previewGoalMonthSchema,
} from '../application/dto/goal-program.dto'

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
    case 'subject_has_goal':
    case 'start_month_changed':
      return 409
    case 'invalid_name':
    case 'invalid_target':
    case 'invalid_subject':
    case 'duplicate_subject':
    case 'assignment_limit_exceeded':
      return 400
  }
}

async function withGoalPrograms<T>(
  run: (
    programs: GoalProgramRequestApi & GoalProgressRequestApi & GoalMonthPreviewRequestApi,
    policy: GoalExecutionPolicy,
    actor: GoalActor,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  const programs = getContainer().goalPublicApi.programs
  const policy = requestPolicy(ctx)
  try {
    return await run(programs, policy, requestActor(ctx))
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

/** A goal's name and description, changed in place: no version, no month moves. */
export const renameGoalProgram = createServerFn({ method: 'POST' })
  .validator(renameGoalProgramSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.rename(policy, data, actor),
        ),
      'POST',
      'goal.renameGoalProgram',
    ),
  )

export const getGoalProgram = createServerFn({ method: 'GET' })
  .validator(goalProgramIdentitySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) => programs.get(policy, data, actor)),
      'GET',
      'goal.getGoalProgram',
    ),
  )

export const listGoalPrograms = createServerFn({ method: 'GET' })
  .validator(listGoalProgramsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => ({
          programs: await programs.list(policy, data.propertyId, actor),
        })),
      'GET',
      'goal.listGoalPrograms',
    ),
  )

export const getGoalProgress = createServerFn({ method: 'GET' })
  .validator(getGoalProgressSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => ({
          goals: await programs.progress(policy, data, actor),
        })),
      'GET',
      'goal.getGoalProgress',
    ),
  )

/** The month so far for every current subject of one goal (the goal's page). */
export const getGoalProgramProgress = createServerFn({ method: 'GET' })
  .validator(goalProgramIdentitySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => ({
          subjects: await programs.programProgress(policy, data, actor),
        })),
      'GET',
      'goal.getGoalProgramProgress',
    ),
  )

/** The month so far for one subject and measure, before its goal is saved. */
export const previewGoalMonth = createServerFn({ method: 'GET' })
  .validator(previewGoalMonthSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => ({
          preview: await programs.monthPreview(policy, data, actor),
        })),
      'GET',
      'goal.previewGoalMonth',
    ),
  )
