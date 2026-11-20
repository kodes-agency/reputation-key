import { z } from 'zod/v4'

/**
 * The Staff page has no search params. Links from when it had a Staff and a
 * Directory tab still carry `?tab=`, so the schema accepts and drops it rather
 * than failing the route.
 */
export const peopleSearchSchema = z.object({})
