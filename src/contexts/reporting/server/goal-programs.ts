import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: do not re-export these. The client build strips
// the validators and then this import, but an `export … from` is an export, so
// it stays, and the bundler keeps the whole DTO module in first paint for its
// top-level zod calls (scripts/check-bundle-budget.mjs, 2026-10-13). Tests and
// forms import the schemas from the DTO.
import {
  getGoalProgressSchema,
  getGoalProgramHistorySchema,
  listGoalProgramsSchema,
} from '../monthly-goals/goal-program.contracts'
import { withGoalPrograms } from './goal-program-request.server'

export const listGoalPrograms = createServerFn({ method: 'GET' })
  .validator(listGoalProgramsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, actor) => ({
          programs: await programs.list(data.propertyId, actor),
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
        withGoalPrograms(async (programs, actor) => ({
          goals: await programs.progress(data, actor),
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
        withGoalPrograms(async (programs, actor) => ({
          goals: await programs.listProgress(data, actor),
        })),
      'GET',
      'goal.getGoalListProgress',
    ),
  )

export const getGoalProgramHistory = createServerFn({ method: 'GET' })
  .validator(getGoalProgramHistorySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, actor) => programs.history(data, actor)),
      'GET',
      'goal.getGoalProgramHistory',
    ),
  )
