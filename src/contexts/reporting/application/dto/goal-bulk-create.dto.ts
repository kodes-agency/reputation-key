// The save of goals for several subjects, as it arrives.
//
// Its own module, apart from the goal command DTO: that one is part of the
// first-paint bundle (every page with a goal server function imports it), and
// this schema is read only by the table that sets several goals, so it loads
// with the table. The fields the two saves share are the single goal's own.
import { z } from 'zod/v4'
import { MAX_GOAL_BULK_ITEMS } from '../../domain/goal-bulk-create'
import { createGoalProgramSchema } from './goal-program.dto'

const uuid = z.uuid()
const { propertyId, metric, startMonth, targetValue } = createGoalProgramSchema.shape

/** A row is for a Portal or a Portal Group, never for the Property as a whole. */
const goalBulkSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('portal_group'), portalGroupId: uuid }),
  z.object({ kind: z.literal('portal'), portalId: uuid }),
])

// A transport-shape validator, like the single goal's. Whether a target suits
// the measure is the command's to say, row by row, so that one wrong number is
// reported for its row and the other rows are saved.
export const createGoalsForSubjectsSchema = z.object({
  propertyId,
  metric,
  // Required here: a save of several goals always names its month.
  startMonth: startMonth.unwrap(),
  items: z
    .array(z.object({ subject: goalBulkSubjectSchema, targetValue }))
    .min(1)
    .max(MAX_GOAL_BULK_ITEMS),
})
