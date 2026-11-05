import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: do not re-export these. The client build strips
// the validators and then this import, but an `export … from` is an export, so
// it stays, and the bundler keeps the whole DTO module in first paint for its
// top-level zod calls (scripts/check-bundle-budget.mjs, 2026-10-13). Tests and
// forms import the schemas from the DTO.
import {
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
  getGoalProgressSchema,
  goalProgramIdentitySchema,
  listGoalProgramsSchema,
} from '../application/dto/goal-program.dto'
import { withGoalPrograms } from './goal-program-request.server'

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

/**
 * The month so far of every active goal of a Property, in one call for the
 * Goals list. Same input as the list it sits beside; the live line of a row.
 */
export const getGoalListProgress = createServerFn({ method: 'GET' })
  .validator(listGoalProgramsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => ({
          goals: await programs.listProgress(policy, data, actor),
        })),
      'GET',
      'goal.getGoalListProgress',
    ),
  )
