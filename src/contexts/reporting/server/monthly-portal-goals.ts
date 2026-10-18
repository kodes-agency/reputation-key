// Monthly portal goal — server functions (ADR 0068).
//
// Never statically imported. `routes/…/goals/-portal-goal-queries.ts` reaches
// this module only by its own `import()`, so it stays a chunk of its own,
// fetched beside the first read: a server-function module that two entries
// share is grouped with the stubs first paint loads (PLAN §0.2, §3.3). It
// imports no other server-function module, and its validators come only from
// the lazy `monthly-portal-goal.dto.ts`, never from first-paint
// `goal-program.dto.ts`; the reads are typed in `monthly-portal-goal.types.ts`.
//
// Each handler runs through `withGoalPrograms`, so every read and the set ask
// the execution policy (capability `goal.use`, the Property grant) for
// `goal.create` before anything is read; a change and the check-in's Keep ask
// it for `goal.update`, and Stop for `goal.cancel`. The Overview prompt's
// "Not now" and a Portal's Results line ask for `goal.create`, as the card. A
// change and a stop never reach `server/goal-month-target.ts` or
// `server/goal-programs.ts`: this module imports no other server-function
// module (PLAN §0.2, E10).
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: never re-exported (an `export … from` would keep
// the DTO module and its zod calls with this module's importers, #794).
import {
  addPortalGoalSchema,
  addPortalGoalsSchema,
  changeMonthlyPortalGoalNowSchema,
  deferMonthlyPortalGoalPromptSchema,
  keepMonthlyPortalGoalSchema,
  monthlyPortalGoalLineSchema,
  monthlyPortalGoalPropertySchema,
  reviseMonthlyPortalGoalSchema,
  setMonthlyPortalGoalSchema,
  stopMonthlyPortalGoalSchema,
} from '../application/dto/monthly-portal-goal.dto'
import { withGoalPrograms } from './goal-program-request.server'

/** The Goals page card: the goal by Program, or the state before one. */
export const getMonthlyPortalGoalCard = createServerFn({ method: 'GET' })
  .validator(monthlyPortalGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.monthlyPortalGoal.card(policy, data, actor),
        ),
      'GET',
      'goal.getMonthlyPortalGoalCard',
    ),
  )

/** The goal's page: the card's arm, and with a goal its months, changes and Portals. */
export const getMonthlyPortalGoalPage = createServerFn({ method: 'GET' })
  .validator(monthlyPortalGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.monthlyPortalGoal.page(policy, data, actor),
        ),
      'GET',
      'goal.getMonthlyPortalGoalPage',
    ),
  )

/** The card's Use: the Monthly portal goal, set from the month it named. */
export const setMonthlyPortalGoal = createServerFn({ method: 'POST' })
  .validator(setMonthlyPortalGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => {
          const { program } = await programs.monthlyPortalGoal.set(policy, data, actor)
          return { programId: program.id }
        }),
      'POST',
      'goal.setMonthlyPortalGoal',
    ),
  )

/** "Add a portal goal": what it offers for one Portal, each, a group or the average. */
export const getPortalGoalAddOptions = createServerFn({ method: 'GET' })
  .validator(monthlyPortalGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.portalGoalAdd.options(policy, data, actor),
        ),
      'GET',
      'goal.getPortalGoalAddOptions',
    ),
  )

/** A goal for one Portal, one Portal Group, or the Property's average. */
export const addPortalGoal = createServerFn({ method: 'POST' })
  .validator(addPortalGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => {
          const { program } = await programs.portalGoalAdd.one(policy, data, actor)
          return { programId: program.id }
        }),
      'POST',
      'goal.addPortalGoal',
    ),
  )

/** A goal for each ticked Portal: each row saved or not on its own. */
export const addPortalGoals = createServerFn({ method: 'POST' })
  .validator(addPortalGoalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.portalGoalAdd.each(policy, data, actor),
        ),
      'POST',
      'goal.addPortalGoals',
    ),
  )

/** "November, now": the running month's number, and the months after it. */
export const changeMonthlyPortalGoalNow = createServerFn({ method: 'POST' })
  .validator(changeMonthlyPortalGoalNowSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => {
          const { month } = await programs.monthlyPortalGoal.changeNow(
            policy,
            data,
            actor,
          )
          return { changed: month !== 'unchanged' }
        }),
      'POST',
      'goal.changeMonthlyPortalGoalNow',
    ),
  )

/** "From Dec 1" and "Count scans instead": the goal from its next month. */
export const reviseMonthlyPortalGoal = createServerFn({ method: 'POST' })
  .validator(reviseMonthlyPortalGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => {
          const { program } = await programs.monthlyPortalGoal.revise(policy, data, actor)
          return { programId: program.id }
        }),
      'POST',
      'goal.reviseMonthlyPortalGoal',
    ),
  )

/** Stop: the goal ends, and the month it is counting keeps counting. */
export const stopMonthlyPortalGoal = createServerFn({ method: 'POST' })
  .validator(stopMonthlyPortalGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms(async (programs, policy, actor) => {
          const program = await programs.monthlyPortalGoal.stop(policy, data, actor)
          return { programId: program.id }
        }),
      'POST',
      'goal.stopMonthlyPortalGoal',
    ),
  )

/** The month-start check-in's Keep: the month keeps its number, and the check-in is answered. */
export const keepMonthlyPortalGoal = createServerFn({ method: 'POST' })
  .validator(keepMonthlyPortalGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.monthlyPortalGoal.keep(policy, data, actor),
        ),
      'POST',
      'goal.keepMonthlyPortalGoal',
    ),
  )

/** The Overview prompt's "Not now": that month's prompt is not shown again. */
export const deferMonthlyPortalGoalPrompt = createServerFn({ method: 'POST' })
  .validator(deferMonthlyPortalGoalPromptSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.monthlyPortalGoal.defer(policy, data, actor),
        ),
      'POST',
      'goal.deferMonthlyPortalGoalPrompt',
    ),
  )

/** A Portal's Results line: its count toward the goal, or its own goal; null for none. */
export const getMonthlyPortalGoalLine = createServerFn({ method: 'GET' })
  .validator(monthlyPortalGoalLineSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.monthlyPortalGoal.line(policy, data, actor),
        ),
      'GET',
      'goal.getMonthlyPortalGoalLine',
    ),
  )
