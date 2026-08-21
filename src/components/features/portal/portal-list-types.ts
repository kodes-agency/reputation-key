import type { Portal } from '#/contexts/portal/application/public-api'

/**
 * A portal as the list renders it. `publicationState` and `theme` are the REAL
 * domain types, read off `Portal` by indexed access — the previous local
 * `interface Portal` re-declared the publication union by hand and typed the
 * theme as `Record<string, unknown>`, which forced a cast to read
 * `primaryColor` and let a newly added publication state type-check here and
 * then render as a raw identifier.
 *
 * `id` is a plain `string`, not the branded `PortalId`: the branded id is
 * assignable to it, and route params and story fixtures deal in strings.
 */
export type PortalListItem = Readonly<{
  id: string
  name: string
  publicationState: Portal['publicationState']
  theme: Portal['theme']
}>
