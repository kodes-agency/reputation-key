// Goal Program server functions — the details a goal carries outside its
// versions: its name and description.
//
// Its own module, apart from goal-programs.ts, on purpose. Several routes share
// the server-function stubs of that module, so the client build merges them
// into a chunk the first paint loads, and every stub added there is paid for on
// first paint (45 B gzip for this one, measured). Only the goal's own page
// renames a goal, and a module one route imports stays out of that chunk.
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { renameGoalProgramSchema } from '../application/dto/goal-program.dto'
import { withGoalPrograms } from './goal-program-request.server'

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
