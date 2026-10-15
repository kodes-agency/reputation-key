// The Property's Google rating goal, in full: the monitoring view one click from
// the simple card on the Goals page (ADR 0067). Behind `goal.use` with the other
// goal routes (the Goals layout), for owners and managers (`goal.read`). Its
// read is primed by the loader from a module fetched on demand, so neither the
// read nor its server function joins first paint.
import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  RatingGoalDetail,
  RatingGoalMissing,
} from '#/components/goals/rating-goal-detail'
import { RatingGoalDetailActions } from '#/components/goals/rating-goal-detail-actions'
import { withRatingGoalRefusals } from '#/components/goals/rating-goal-refusal'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import { ratingGoalStatusBadge } from '#/components/goals/rating-goal-view'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  markRatingGoalReadsStale,
  ratingGoalCommands,
  ratingGoalDetailQuery,
} from './-rating-goal-queries'
import { useRatingGoalWizard } from './-rating-goal-wizard-host'

const TITLE = 'Google rating goal'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/google-rating',
)({
  staticData: { page: { title: TITLE, under: 'goals' } },
  // As the goal's own page ($goalId) asks: of the built-in roles only the two
  // interactive manager roles hold `goal.read`, so the Member is answered here.
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw roleUnavailable(TITLE, 'properties')
    }
  },
  // `fetchQuery`, not `ensureQueryData`: a read that a set, change or end has
  // marked stale is read again before the page draws, never shown first.
  loader: async ({ params, context }) => {
    const queries = await import('./-rating-goal-queries')
    await context.queryClient.fetchQuery(queries.ratingGoalDetailQuery(params.propertyId))
  },
  component: GoogleRatingGoalRoute,
})

/**
 * Ends the goal, then goes back to the Goals page, where its History is. The
 * reads are marked stale, not read again here: a refetch of this page's own
 * read would draw its "no goal" state for the length of the way back. The Goals
 * page's loader reads them afresh.
 */
function useEndRatingGoal(propertyId: string) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const family = goalKeys.ratingGoal(propertyId)
  return useActionMutation(withRatingGoalRefusals(ratingGoalCommands.endRatingGoal), {
    successMessage: 'Google rating goal ended',
    // The Property's setup step and its Properties list cell move with the goal.
    invalidateKeys: [
      propertyKeys.setup(propertyId),
      propertyKeys.setupSummaries(),
      dashboardKeys.fleets(),
    ],
    // A refusal usually means this page is behind: read the goal again.
    onError: () => void queryClient.invalidateQueries({ queryKey: family }),
    onSuccess: async () => {
      await markRatingGoalReadsStale(queryClient, propertyId)
      await navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })
    },
  })
}

/**
 * A detail read that found the goal reached or ended has moved it to History:
 * the Goals page's reads of it are behind, and are read afresh when it is next
 * drawn (it then tells the news, and offers the next goal).
 */
function useGoalsPageCatchesUp(propertyId: string, moved: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (moved) void markRatingGoalReadsStale(queryClient, propertyId)
  }, [moved, queryClient, propertyId])
}

function GoogleRatingGoalRoute() {
  const { propertyId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const [now] = useState(() => new Date())
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const read = useSuspenseQuery(ratingGoalDetailQuery(propertyId))
  const detail = read.data
  const { timezone, name } = propData.property
  const active = detail?.state === 'active'
  // The wizard's setup, read ahead while the goal can change: the change opens on it.
  const { start, wizard, setup } = useRatingGoalWizard(propertyId, {
    hasPortals: true,
    readSetup: active && canDo('goal.update'),
  })
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  const end = useEndRatingGoal(propertyId)
  useGoalsPageCatchesUp(propertyId, detail !== null && !active)
  return (
    <PageShell key={propertyId}>
      <PageHeader
        title={TITLE}
        meta={
          detail === null
            ? undefined
            : [<StatusBadge key="status" {...ratingGoalStatusBadge(detail)} />]
        }
        breadcrumbs={trailCrumbs('goals', { propertyId, propertyName: name }, TITLE)}
        actions={
          detail === null ? undefined : (
            <RatingGoalDetailActions
              goal={detail}
              setup={setup.data}
              onChange={() => start({ kind: 'change', goal: detail })}
              onEnd={() =>
                end({
                  data: {
                    propertyId,
                    goalId: detail.goalId,
                    expectedVersion: detail.version,
                  },
                })
              }
            />
          )
        }
      />
      {detail === null ? (
        <RatingGoalMissing propertyId={propertyId} />
      ) : (
        <RatingGoalDetail
          detail={detail}
          readAt={new Date(read.dataUpdatedAt)}
          timezone={timezone}
          now={now}
          personName={goalPersonNames(members.data?.members)}
        />
      )}
      {wizard}
    </PageShell>
  )
}
