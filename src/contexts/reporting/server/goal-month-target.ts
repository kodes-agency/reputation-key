// Goal Program server functions — changing the target of a month that is
// still running.
//
// Its own module, apart from goal-programs.ts: several routes share that
// module's server-function stubs, so the client build merges them into a chunk
// the first paint loads, and every stub added there is paid for on first paint.
// No screen calls it since the goal page's month-target dialog was retired
// (PLAN PG-21); the e2e journeys still drive it.
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { changeGoalMonthTargetSchema } from '../application/dto/goal-month-target.dto'
import { withGoalPrograms } from './goal-program-request.server'

/**
 * This month's target, and the months after when asked. Refusals arrive as
 * GoalProgramError codes: `month_locked`, `no_open_month`, `revision_conflict`
 * and `invalid_transition` (409), `invalid_target` (400).
 */
export const changeGoalMonthTarget = createServerFn({ method: 'POST' })
  .validator(changeGoalMonthTargetSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.changeMonthTarget(policy, data, actor),
        ),
      'POST',
      'goal.changeGoalMonthTarget',
    ),
  )
