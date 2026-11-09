// Load this module on demand because route loaders are first-paint code. Fetch monthly-
// portal-goals only through import(): shared static RPC imports would join the first-
// paint stub chunk. Results reads are the exception, reusing list RPCs already loaded
// by the Goals route. Query definitions stay shared across pages.

import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { dashboardKeys, goalKeys } from '#/shared/queries/query-keys'
// The Portal goal results page's reads (below): the Goals list's own.
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import {
  getGoalProgramHistory,
  listGoalPrograms,
} from '#/contexts/reporting/server/goal-programs'
import { portalKeys } from '#/shared/queries/query-keys'

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
 * The goal's page (`/goals/portals`): the card's arm, and with a goal its months,
 * changes and Portals. Fresh as long as a running month's read.
 */
export const portalGoalPageQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.portalGoalRead(propertyId, 'page'),
    queryFn: async () =>
      (await server()).getMonthlyPortalGoalPage({ data: { propertyId } }),
    staleTime: (query) =>
      query.state.data?.card.state === 'goal'
        ? PORTAL_GOAL_STALE_MS
        : BEFORE_GOAL_STALE_MS,
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
  changeMonthlyPortalGoalNow: async (
    input: Parameters<MonthlyPortalGoalServer['changeMonthlyPortalGoalNow']>[0],
  ) => (await server()).changeMonthlyPortalGoalNow(input),
  reviseMonthlyPortalGoal: async (
    input: Parameters<MonthlyPortalGoalServer['reviseMonthlyPortalGoal']>[0],
  ) => (await server()).reviseMonthlyPortalGoal(input),
  stopMonthlyPortalGoal: async (
    input: Parameters<MonthlyPortalGoalServer['stopMonthlyPortalGoal']>[0],
  ) => (await server()).stopMonthlyPortalGoal(input),
  keepMonthlyPortalGoal: async (
    input: Parameters<MonthlyPortalGoalServer['keepMonthlyPortalGoal']>[0],
  ) => (await server()).keepMonthlyPortalGoal(input),
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

/** A read of the goals is good for this long, as on the Goals page. */
const GOALS_STALE_MS = 30_000

type ListedProgram = Awaited<ReturnType<typeof listGoalPrograms>>['programs'][number]

/** The matrix and notification links explicitly ask for retained history. */
export async function readPortalGoalProgramHistories(
  propertyId: string,
  summaries?: readonly ListedProgram[],
) {
  const listed = summaries ?? (await listGoalPrograms({ data: { propertyId } })).programs
  const programs = await Promise.all(
    listed.map(async (summary) => {
      const results = new Map(summary.results.map((row) => [row.id, row]))
      const versions = new Map(summary.versions.map((row) => [row.id, row]))
      const assignments = new Map(summary.assignments.map((row) => [row.id, row]))
      const changes = new Map(summary.targetChanges?.map((row) => [row.id, row]))
      const targetProvenance = { ...summary.targetProvenance }
      let after: { periodStart: Date; id: string } | undefined
      do {
        const page = await getGoalProgramHistory({
          data: { propertyId, programId: summary.program.id, after },
        })
        for (const row of page.results) results.set(row.id, row)
        for (const row of page.versions) versions.set(row.id, row)
        for (const row of page.assignments) assignments.set(row.id, row)
        for (const row of page.targetChanges) changes.set(row.id, row)
        Object.assign(targetProvenance, page.targetProvenance)
        after = page.next ?? undefined
      } while (after)
      return {
        ...summary,
        targetProvenance,
        results: [...results.values()].sort(
          (a, b) =>
            a.periodStart.getTime() - b.periodStart.getTime() || a.id.localeCompare(b.id),
        ),
        versions: [...versions.values()],
        assignments: [...assignments.values()],
        targetChanges: [...changes.values()].sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.changeId.localeCompare(b.changeId) ||
            a.monthlyResultId.localeCompare(b.monthlyResultId),
        ),
      }
    }),
  )
  return { programs }
}

/** Summary and history caches are distinct; mutations invalidate their shared prefix. */
export const portalGoalResultsQueries = (
  propertyId: string,
  queryClient?: QueryClient,
) => {
  const summaries = queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: GOALS_STALE_MS,
  })
  const readHistory = async () =>
    readPortalGoalProgramHistories(
      propertyId,
      (
        await (queryClient
          ? queryClient.fetchQuery(summaries)
          : listGoalPrograms({ data: { propertyId } }))
      ).programs,
    )
  return {
    goals: queryOptions({
      queryKey: [...goalKeys.list({ propertyId, model: 'program' }), 'history'],
      queryFn: readHistory,
      staleTime: GOALS_STALE_MS,
    }),
    subjectNames: queryOptions({
      queryKey: portalKeys.goalSubjectNames(propertyId),
      queryFn: async () => {
        const [groups, portals] = await Promise.all([
          listPortalGroups({ data: { propertyId } }),
          listPortals({ data: { propertyId } }),
        ])
        return { groups: groups.groups, portals: portals.portals }
      },
    }),
  }
}

/**
 * Primes the results page: both reads, together. A failure fails the page, as
 * on the Goals page: without its goals it has nothing to show.
 */
export async function prefetchPortalGoalResults(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  const queries = portalGoalResultsQueries(propertyId, queryClient)
  await Promise.all([
    queryClient.ensureQueryData(queries.goals),
    queryClient.ensureQueryData(queries.subjectNames),
  ])
}

/**
 * What "Add a portal goal" offers (PLAN PG-20): made of Portal's facts as much
 * as the goals, so it goes stale as soon as the card before a goal does; every
 * Portal-goal command marks it stale with the rest (`portalGoal(propertyId)`).
 */
export const portalGoalAddQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.portalGoalRead(propertyId, 'add'),
    queryFn: async () =>
      (await server()).getPortalGoalAddOptions({ data: { propertyId } }),
    staleTime: BEFORE_GOAL_STALE_MS,
  })

/**
 * Primes "Add a portal goal", so its door is drawn with the section, never
 * after it. A failure leaves the door out; nothing else waits on it.
 */
export async function prefetchPortalGoalAdd(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  await queryClient.prefetchQuery(portalGoalAddQuery(propertyId))
}

/** "Add a portal goal"'s commands, fetched with their first use like the reads. */
export const portalGoalAddCommands = {
  addPortalGoal: async (input: Parameters<MonthlyPortalGoalServer['addPortalGoal']>[0]) =>
    (await server()).addPortalGoal(input),
  addPortalGoals: async (
    input: Parameters<MonthlyPortalGoalServer['addPortalGoals']>[0],
  ) => (await server()).addPortalGoals(input),
}

/**
 * What an added goal marks stale (PLAN PG-20): every Portal-goal read, through
 * `markPortalGoalReadsStale`, and the month so far of the goals that target each
 * subject it was added for (`progress(propertyId, 'portal_group:<id>')`, a Portal
 * Group page's goal card), which sits under no Portal-goal key. Never the Goals
 * family root.
 */
export async function markPortalGoalAddedStale(
  queryClient: QueryClient,
  propertyId: string,
  subjects: readonly string[],
): Promise<void> {
  await Promise.all([
    markPortalGoalReadsStale(queryClient, propertyId),
    ...subjects.map((subject) =>
      queryClient.invalidateQueries({ queryKey: goalKeys.progress(propertyId, subject) }),
    ),
  ])
}

/**
 * A Portal's Results line (PLAN PG-16): its count toward the Monthly portal
 * goal this month, or its own goal's month so far; null for no line. Fresh as
 * long as a running month's read.
 */
export const portalGoalLineQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: goalKeys.portalGoalLine(propertyId, portalId),
    queryFn: async () =>
      (await server()).getMonthlyPortalGoalLine({ data: { propertyId, portalId } }),
    staleTime: PORTAL_GOAL_STALE_MS,
  })

/**
 * The Overview prompt's "Not now" (PLAN PG-16), fetched with its first use like
 * the other commands; it marks the reads stale through `markPortalGoalReadsStale`.
 */
export const deferPortalGoalPrompt = async (
  input: Parameters<MonthlyPortalGoalServer['deferMonthlyPortalGoalPrompt']>[0],
) => (await server()).deferMonthlyPortalGoalPrompt(input)

/**
 * The page of a goal for one Portal, one Portal Group or the average (PLAN
 * PG-21), on `$goalId`; a Property count goal answers that its page is
 * `/goals/portals`. Under the Portal goals' key, so every Portal-goal command
 * marks it stale with the rest. Fresh as long as a running month's read.
 */
export const portalGoalSinglePageQuery = (propertyId: string, programId: string) =>
  queryOptions({
    queryKey: goalKeys.portalGoalRead(propertyId, `goal:${programId}`),
    queryFn: async () =>
      (await server()).getPortalGoalSinglePage({ data: { propertyId, programId } }),
    staleTime: PORTAL_GOAL_STALE_MS,
  })

/** Staff's person sheet shares the Portal Results line without another server-module importer. */
export async function readPortalGoalLine(propertyId: string, portalId: string) {
  return (await server()).getMonthlyPortalGoalLine({ data: { propertyId, portalId } })
}
