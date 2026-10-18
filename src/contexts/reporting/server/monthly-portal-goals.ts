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
// Each handler runs through `withGoalPrograms`, so every read asks the
// execution policy (capability `goal.use`, the Property grant) for
// `goal.create` before anything is read.
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: never re-exported (an `export … from` would keep
// the DTO module and its zod calls with this module's importers, #794).
import { monthlyPortalGoalPropertySchema } from '../application/dto/monthly-portal-goal.dto'
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
