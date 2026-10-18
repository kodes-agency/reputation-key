// The Monthly portal goal's reads, defined once for every page that draws it
// (route-query-definitions.test.ts), its commands, and the one function every
// Portal-goal command marks them stale through (the product-state ledger's
// goalKeys policy); its first caller is the card's Use.
//
// None of it may reach first paint (scripts/check-bundle-budget.mjs):
//
// - The loader that primes the card imports this module on demand, through
//   `-goals-page-prefetch.ts`: a route's loader is first-paint code.
// - The server functions are fetched with their first use, never imported:
//   `#/contexts/reporting/server/monthly-portal-goals` is reached only by the
//   `import()` below, so it stays a chunk of its own, fetched beside the first
//   read. A server-function module that two entries share is grouped with the
//   stubs first paint loads (vite.config.ts, `app-server-fns`).
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { dashboardKeys, goalKeys } from '#/shared/queries/query-keys'

type MonthlyPortalGoalServer =
  typeof import('#/contexts/reporting/server/monthly-portal-goals')

const server = (): Promise<MonthlyPortalGoalServer> =>
  import('#/contexts/reporting/server/monthly-portal-goals')

/** A read of the month so far is good for this long; a focused tab reads it again. */
const PORTAL_GOAL_STALE_MS = 30_000

/**
 * The card before a goal is good only this long. It is made of Portal's facts (a
 * Portal created, published or turned off, a code made), and no Portal command
 * marks a goal read stale: the gate's "Open Spa" or "Create a portal" leads away
 * and back. Long enough that the loader's read is still fresh when the section
 * mounts; shorter than any trip to a Portal and back.
 */
const BEFORE_GOAL_STALE_MS = 5_000

export const portalGoalCardQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.portalGoalRead(propertyId, 'card'),
    queryFn: async () =>
      (await server()).getMonthlyPortalGoalCard({ data: { propertyId } }),
    staleTime: (query) =>
      query.state.data?.state === 'goal' ? PORTAL_GOAL_STALE_MS : BEFORE_GOAL_STALE_MS,
  })

/**
 * Primes the Goals page's Portal goals section: its card. A failure is left to
 * the section, which says so in its own region; the Google section never fails
 * with it.
 */
export async function prefetchPortalGoalSection(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  // `prefetchQuery` never throws: a failed read is the section's to say.
  await queryClient.prefetchQuery(portalGoalCardQuery(propertyId))
}

/**
 * The Monthly portal goal's commands, each fetched with its first use like the
 * reads: a component is handed these, never the server module.
 */
export const portalGoalCommands = {
  setMonthlyPortalGoal: async (
    input: Parameters<MonthlyPortalGoalServer['setMonthlyPortalGoal']>[0],
  ) => (await server()).setMonthlyPortalGoal(input),
}

/**
 * Marks every read a Portal-goal command changes: the Monthly portal goal's own
 * reads, the Goals list and its month so far (a Property goal is a row of it),
 * and the dashboard's below-pace counts. Never the Goals family root: the
 * Google rating goal's reads are not a Portal goal's to refresh.
 */
export async function markPortalGoalReadsStale(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: goalKeys.portalGoal(propertyId) }),
    queryClient.invalidateQueries({ queryKey: goalKeys.listProgress(propertyId) }),
    queryClient.invalidateQueries({
      queryKey: goalKeys.list({ propertyId, model: 'program' }),
    }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.fleets() }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.property({ propertyId }) }),
  ])
}
