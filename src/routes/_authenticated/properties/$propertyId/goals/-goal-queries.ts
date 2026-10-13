// The reads more than one Goals page makes. Each is defined here once, so the
// list, a goal's own page and the New goal form hold the same options for the
// cache entry they share (see `-queries/route-queries.ts` for why that matters).
import { queryOptions } from '@tanstack/react-query'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { listGoalPrograms } from '#/contexts/reporting/server/goal-programs'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'

/**
 * The Property's goals: the Goals list, and the New goal form, which reads them
 * to say which goal holds a subject.
 */
export const goalProgramsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: 30_000,
  })

/** The groups and portals a goal's subjects are named from: the list and a goal's own page. */
export const goalSubjectNamesQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.goalSubjectNames(propertyId),
    queryFn: async () => {
      const [groups, portals] = await Promise.all([
        listPortalGroups({ data: { propertyId } }),
        listPortals({ data: { propertyId } }),
      ])
      return { groups: groups.groups, portals: portals.portals }
    },
  })
