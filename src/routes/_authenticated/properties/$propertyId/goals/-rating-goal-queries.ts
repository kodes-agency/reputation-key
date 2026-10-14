// The Property Google rating goal's four reads, defined once for the Goals page,
// the goal's detail page, the Property Overview and the Google import's last
// step (route-query-definitions.test.ts), and its four commands.
//
// None of it may reach first paint (scripts/check-bundle-budget.mjs):
//
// - The loaders that prime the reads import this module on demand: a route's
//   loader is first-paint code, and only the pages that draw the goal need it.
// - The server functions are fetched with their first use, not imported. Two
//   lazy pages (and the loaders' import) share them, and a server-function
//   module that two entries share is grouped with the stubs first paint already
//   loads (vite.config.ts, `app-server-fns`, merged under 16 KiB): measured on
//   2026-10-14, the seven stubs put 318 B gzip into the first-paint closure. A
//   module reached only by its own dynamic import is shared by nothing, so it
//   stays a chunk of its own, fetched beside the first read.
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { goalKeys } from '#/shared/queries/query-keys'

type RatingGoalServer = typeof import('#/contexts/reporting/server/rating-goals')

const server = (): Promise<RatingGoalServer> =>
  import('#/contexts/reporting/server/rating-goals')

type Input<K extends keyof RatingGoalServer> = Parameters<RatingGoalServer[K]>[0]

/**
 * Set, change and end: the commands the wizard and the detail page send; and
 * "Not now", which the setup strip and the import's last step send.
 */
export const ratingGoalCommands = {
  setRatingGoal: async (input: Input<'setRatingGoal'>) =>
    (await server()).setRatingGoal(input),
  changeRatingGoal: async (input: Input<'changeRatingGoal'>) =>
    (await server()).changeRatingGoal(input),
  endRatingGoal: async (input: Input<'endRatingGoal'>) =>
    (await server()).endRatingGoal(input),
  deferRatingGoal: async (input: Input<'deferRatingGoal'>) =>
    (await server()).deferRatingGoal(input),
}

export type RatingGoalCommands = typeof ratingGoalCommands

/** Google's numbers move every 15 minutes to 6 hours; a read is good for this long. */
const RATING_GOAL_STALE_MS = 30_000

export const ratingGoalCardQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'card'),
    queryFn: async () => (await server()).getRatingGoalCard({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

/** Eligibility, Google's numbers, the stops and the paces: the wizard and the empty states. */
export const ratingGoalSetupQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'setup'),
    queryFn: async () => (await server()).getRatingGoalSetup({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

export const ratingGoalDetailQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'detail'),
    queryFn: async () => (await server()).getRatingGoalDetail({ data: { propertyId } }),
    staleTime: RATING_GOAL_STALE_MS,
  })

export const ratingGoalHistoryQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.ratingGoalRead(propertyId, 'history'),
    queryFn: async () => (await server()).getRatingGoalHistory({ data: { propertyId } }),
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
