// The Properties list's URL: what is searched, shown and sorted. Every key is
// optional with no default, so the default view is a bare `/properties` — the
// dashboard redirect and every typed link to the list rely on that — and a
// value a hand-edited URL cannot mean is dropped rather than refusing the page.
import { z } from 'zod/v4'

export const PROPERTY_LIST_SORTS = [
  'attention',
  'name',
  'rating',
  'reviews',
  'setup',
] as const
export type PropertyListSort = (typeof PROPERTY_LIST_SORTS)[number]

export const PROPERTY_LIST_SHOWS = ['attention', 'setup', 'google'] as const
export type PropertyListShow = (typeof PROPERTY_LIST_SHOWS)[number]

export type SortDirection = 'asc' | 'desc'

export const propertyListSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  show: z.enum(PROPERTY_LIST_SHOWS).optional().catch(undefined),
  sort: z.enum(PROPERTY_LIST_SORTS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
})

export type PropertyListSearch = z.infer<typeof propertyListSearchSchema>
