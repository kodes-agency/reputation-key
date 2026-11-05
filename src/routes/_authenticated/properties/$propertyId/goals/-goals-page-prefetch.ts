// Import on demand to keep goal reads and server functions out of first paint. Prime
// both sections concurrently and isolate failures. Read card and add offers only for
// viewers allowed to set goals.

import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { prefetchPortalGoalAdd, prefetchPortalGoalSection } from './-portal-goal-queries'
import {
  prefetchRatingGoalOverview,
  prefetchRatingGoalSection,
} from './-rating-goal-queries'

// The loader calls this through its import, never destructured: that would
// cost first paint a wrapper that spells the name three times.
export async function prefetchGoalsPage(
  queryClient: QueryClient,
  propertyId: string,
  role: Role,
): Promise<void> {
  await Promise.all([
    prefetchRatingGoalSection(queryClient, propertyId),
    can(role, 'goal.create')
      ? Promise.all([
          prefetchPortalGoalSection(queryClient, propertyId),
          // The section's door to "Add a portal goal" is drawn only when it
          // offers something (PLAN PG-20), so it is read with the card.
          prefetchPortalGoalAdd(queryClient, propertyId),
        ])
      : Promise.resolve(),
  ])
}

// Prime the Overview through the same lazy entry as the Goals page. A failed
// read leaves its goal out, and both reads settle before priming completes.
export async function prefetchOverviewGoals(
  queryClient: QueryClient,
  propertyId: string,
  role: Role,
): Promise<void> {
  await Promise.allSettled([
    prefetchRatingGoalOverview(queryClient, propertyId),
    can(role, 'goal.create')
      ? prefetchPortalGoalSection(queryClient, propertyId)
      : Promise.resolve(),
  ])
}
