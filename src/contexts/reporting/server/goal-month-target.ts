// Goal Program server functions — changing the target of a month that is
// still running.
//
// Its own module, apart from goal-programs.ts, for the reason
// goal-program-details.ts gives: several routes share that module's
// server-function stubs, so every stub added there is paid for on first paint.
// Only the goal's own page changes a month's target.
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
