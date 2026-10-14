import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: do not re-export these. The client build strips
// the validators and then this import, but an `export … from` is an export, so
// it stays, and the bundler keeps the whole DTO module in first paint for its
// top-level zod calls (scripts/check-bundle-budget.mjs, 2026-10-13). Tests and
// forms import the schemas from the DTO.
import {
  changeGoalProgramAssignmentsSchema,
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
  getGoalProgressSchema,
  goalProgramIdentitySchema,
  listGoalProgramsSchema,
  previewGoalMonthSchema,
  reviseGoalProgramSchema,
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
