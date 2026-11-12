import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { prefetchPortalGoalAdd, prefetchPortalGoalSection } from './-portal-goal-queries'
import {
  prefetchRatingGoalOverview,
  prefetchRatingGoalSection,
} from './-rating-goal-queries'

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
          // offers something, so it is read with the card.
          prefetchPortalGoalAdd(queryClient, propertyId),
        ])
      : Promise.resolve(),
  ])
}

// A failed read leaves its goal out; both reads settle before priming completes.
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
