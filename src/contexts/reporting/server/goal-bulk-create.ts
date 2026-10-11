// Reporting — the server function that sets goals for several subjects.
//
// Apart from goal-programs.ts on purpose: that module's stubs are part of the
// first-paint bundle, and this one is called only by the table that sets
// several goals, so it and its input schema load with the table.
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { createGoalsForSubjectsSchema } from '../application/dto/goal-bulk-create.dto'
import { withGoalPrograms } from './goal-program-request.server'

/**
 * One goal per row. A save refused as a whole throws (its month is no longer
 * offered, its rows are not a valid set); otherwise the answer says what
 * happened to each row, and a row that got no goal is an outcome, not an error.
 */
export const createGoalsForSubjects = createServerFn({ method: 'POST' })
  .validator(createGoalsForSubjectsSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withGoalPrograms((programs, policy, actor) =>
          programs.createForSubjects(policy, data, actor),
        ),
      'POST',
      'goal.createGoalsForSubjects',
    ),
  )
