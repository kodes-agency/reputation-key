import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { goalKeys } from '#/shared/queries/query-keys'
import {
  setRatingGoal,
  changeRatingGoal,
  endRatingGoal,
  keepRatingGoalPace,
  deferRatingGoal,
  getRatingGoalCard,
  getRatingGoalSetup,
  getRatingGoalDetail,
  getRatingGoalHistory,
} from '#/contexts/reporting/server/rating-goals'

/**
 * Set, change and end: the commands the wizard and the detail page send; Keep,
 * which the Monday check-in sends (Raise and Ease are changes); and "Not now",
 * which the setup strip and the import's last step send.
 */
export const ratingGoalCommands = {
  setRatingGoal,
  changeRatingGoal,
  endRatingGoal,
  keepRatingGoalPace,
  deferRatingGoal,
}

export type RatingGoalCommands = typeof ratingGoalCommands

/** Google's numbers move every 15 minutes to 6 hours; a read is good for this long. */
const RATING_GOAL_STALE_MS = 30_000

export const ratingGoalCardQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'card'),
    queryFn: () => getRatingGoalCard({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

/** Eligibility, Google's numbers, the stops and the paces: the wizard and the empty states. */
export const ratingGoalSetupQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'setup'),
    queryFn: () => getRatingGoalSetup({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

export const ratingGoalDetailQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'detail'),
    queryFn: () => getRatingGoalDetail({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

export const ratingGoalHistoryQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'history'),
    queryFn: () => getRatingGoalHistory({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

/**
 * Primes the Goals page's Google section: the card, the setup (the empty states
 * and the wizard) and the History (a goal reached or ended lately), all at once,
 * so the page waits for no Google read after another. A failure is left to the
 * section, which says so in its own region; the Portal goals never fail with it.
 */
export async function prefetchRatingGoalSection(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  // `prefetchQuery` never throws: a failed read is the section's to say.
  await Promise.all([
    queryClient.prefetchQuery(ratingGoalCardQuery(propertyId)),
    queryClient.prefetchQuery(ratingGoalSetupQuery(propertyId)),
    queryClient.prefetchQuery(ratingGoalHistoryQuery(propertyId)),
  ])
}

/**
 * Primes the Property Overview's Google goal: the card first, then, only when
 * there is no active goal, the setup (whether the one-line prompt shows) and
 * History (a goal reached or ended lately). A Property with a goal costs the
 * Overview one goal read. `prefetchQuery` never throws: a failed read leaves the
 * Overview without the goal, never in an error.
 */
export async function prefetchRatingGoalOverview(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  const card = ratingGoalCardQuery(propertyId)
  await queryClient.prefetchQuery(card)
  const read = queryClient.getQueryData(card.queryKey)
  if (read === undefined || read?.state === 'active') return
  await Promise.all([
    queryClient.prefetchQuery(ratingGoalSetupQuery(propertyId)),
    queryClient.prefetchQuery(ratingGoalHistoryQuery(propertyId)),
  ])
}

/**
 * Marks every read of the goal stale without reading any of it again now: the
 * next page that draws one reads it afresh. For a page that is leaving (the
 * detail, once its goal is ended) or has learned the goal moved on (a detail
 * read that found it reached), where a refetch here would only flash the
 * page's own "no goal" state.
 */
export const markRatingGoalReadsStale = (
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: goalKeys.ratingGoal(propertyId),
    refetchType: 'none',
  })
