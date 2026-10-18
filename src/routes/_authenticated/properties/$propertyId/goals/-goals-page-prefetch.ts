// The Goals page loader's one on-demand import (PLAN §0.2 "Loader imports"):
// it primes the Google section and the Portal goals section together, so the
// page waits for no goal read after another, and their reads and server
// functions stay out of first paint. Each section says its own failure; a
// failed read here holds neither back. The Portal goals' card, and what "Add a
// portal goal" offers, are read only for someone who may set the goal, since
// that is who they are for.
import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { prefetchPortalGoalAdd, prefetchPortalGoalSection } from './-portal-goal-queries'
import { prefetchRatingGoalSection } from './-rating-goal-queries'

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

// The Overview loader's priming (PG-16) is fetched through this same module,
// so both loaders reach one on-demand chunk: a chunk of its own for it cost
// first paint 26 B more (measured 2026-10-18, its name and dependency list in
// the entry's preload map).
export { prefetchOverviewGoals } from '../-overview-goals-prefetch'
