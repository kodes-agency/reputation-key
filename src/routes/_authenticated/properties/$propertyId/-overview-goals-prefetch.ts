// The Overview loader's priming (PLAN §0.2 "Loader imports", PG-16), reached
// through its one on-demand import, the Goals page's `-goals-page-prefetch`,
// which re-exports it so the two loaders share one chunk. It primes the Google
// rating goal and the Monthly portal goal together, so
// their reads and server functions stay out of first paint and neither waits
// for the other. It settles once both have, whichever way: a failed read leaves
// its goal out of the Overview, never the page in an error. The loader holds
// the page for this at most its grace (`RATING_GOAL_GRACE_MS`), so the Overview
// waits for the slower of the two, never longer. The Monthly portal goal's card
// is read only for someone who may set the goal, since that is who it is for.
// On the server the loader drops what is still pending when the grace ends
// (`primeWithinGrace`), by the families `goalKeys.ratingGoal` and
// `goalKeys.portalGoal` it names itself: a read started here must sit under one.
import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { prefetchPortalGoalSection } from './goals/-portal-goal-queries'
import { prefetchRatingGoalOverview } from './goals/-rating-goal-queries'

// The loader calls this through its import, never destructured: that would
// cost first paint a wrapper that spells the name three times.
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
