// The Property Google rating goal's four reads, defined once for the Goals page
// and the goal's detail page (route-query-definitions.test.ts), and its three
// commands.
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

/** Set, change and end: the commands the wizard and the detail page send. */
export const ratingGoalCommands = {
  setRatingGoal: async (input: Input<'setRatingGoal'>) =>
    (await server()).setRatingGoal(input),
  changeRatingGoal: async (input: Input<'changeRatingGoal'>) =>
    (await server()).changeRatingGoal(input),
  endRatingGoal: async (input: Input<'endRatingGoal'>) =>
    (await server()).endRatingGoal(input),
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
 * Primes the Goals page's Google section: the card, and the setup when there is
 * no goal (its empty state says why or offers the wizard). A failure is left to
 * the section, which says so in its own region: the Portal goals below it never
 * wait on Google.
 */
export async function prefetchRatingGoalSection(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  const card = await queryClient
    .fetchQuery(ratingGoalCardQuery(propertyId))
    .catch(() => undefined)
  if (card === null) await queryClient.prefetchQuery(ratingGoalSetupQuery(propertyId))
}
