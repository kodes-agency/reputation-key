import { z } from 'zod/v4'

export const peopleSearchSchema = z.object({
  tab: z.enum(['staff', 'directory']).optional(),
})
