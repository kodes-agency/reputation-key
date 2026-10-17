// The Goals page loader's one on-demand import (PLAN §0.2 "Loader imports"):
// it primes the Google section and the Portal goals section together, so the
// page waits for no goal read after another, and their reads and server
// functions stay out of first paint. Each section says its own failure; a
// failed read here holds neither back. The Portal goals' card is read only for
// someone who may set the goal, since that is who it is for.
import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { prefetchPortalGoalSection } from './-portal-goal-queries'
import { prefetchRatingGoalSection } from './-rating-goal-queries'

export async function prefetchGoalsPage(
  queryClient: QueryClient,
  propertyId: string,
  role: Role,
): Promise<void> {
  await Promise.all([
    prefetchRatingGoalSection(queryClient, propertyId),
    can(role, 'goal.create')
      ? prefetchPortalGoalSection(queryClient, propertyId)
      : Promise.resolve(),
  ])
}
