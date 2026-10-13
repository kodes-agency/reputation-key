import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  changeGoalProgramAssignments,
  changeGoalProgramStatus,
  getGoalProgram,
  getGoalProgramProgress,
  reviseGoalProgram,
} from '#/contexts/reporting/server/goal-programs'
// Their own modules: only this page renames a goal or changes a month's target
// (see the note in each module).
import { renameGoalProgram } from '#/contexts/reporting/server/goal-program-details'
import { changeGoalMonthTarget } from '#/contexts/reporting/server/goal-month-target'
import { effectiveMonthTarget } from '#/contexts/reporting/application/goal-effective-month-target'
import { monthTargetMarker } from '#/contexts/reporting/application/goal-month-target-marker'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { goalTargetProvenance } from '#/contexts/reporting/application/goal-target-provenance'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { StatusBadge } from '#/components/ui/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { GoalMonthTargetDialog } from '#/components/goals/goal-month-target-dialog'
import { GoalProgramCard } from '#/components/goals/goal-program-card'
import { GoalProgramRevisionDialog } from '#/components/goals/goal-program-revision-dialog'
import { GoalProgramAssignmentsDialog } from '#/components/goals/goal-program-assignments-dialog'
import { GoalProgramRenameDialog } from '#/components/goals/goal-program-rename-dialog'
import { GoalStatusActions } from '#/components/goals/goal-status-actions'
import { GOAL_STATUS, goalResultStatus } from '#/components/goals/goal-status'
import { GoalTargetChanges } from '#/components/goals/goal-target-changes'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import { withGoalRefusals } from '#/components/goals/goal-refusal'
import {
  goalDay,
  goalMonthNotes,
  goalNoResultsText,
} from '#/components/goals/goal-detail-view'
import { goalSubjectKey } from '#/components/goals/goal-subject-picker'
import { formatDate } from '#/lib/format'

const goalQuery = (propertyId: string, programId: string) =>
  queryOptions({
    queryKey: goalKeys.detail(propertyId, programId),
    queryFn: () => getGoalProgram({ data: { propertyId, programId } }),
    staleTime: 30_000,
  })
// The live month to date of each current subject, for the row of the month
// still running: never a result, and a side read that never holds the page back.
const goalSoFarQuery = (propertyId: string, programId: string) =>
  queryOptions({
    queryKey: goalKeys.programProgress(propertyId, programId),
    queryFn: () => getGoalProgramProgress({ data: { propertyId, programId } }),
    staleTime: 30_000,
  })
const subjectNamesQuery = (propertyId: string) =>
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

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  staticData: { page: { title: 'Goal', under: 'goals' } },
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw roleUnavailable('Goal', 'properties')
    }
  },
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(goalQuery(params.propertyId, params.goalId)),
      context.queryClient.ensureQueryData(subjectNamesQuery(params.propertyId)),
    ])
  },
  component: GoalDetailRoute,
})

function GoalDetailRoute() {
  const { propertyId, goalId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const [now] = useState(() => new Date())
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalQuery(propertyId, goalId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  // Who changed a target, by name. A side read that never holds the page back:
  // until it has been read, a change is told without a person.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  // Pause and Resume act at once, so a refusal (an invalid transition) is a
  // toast. End confirms first, in a dialog that stays open and says a refusal
  // itself, so it is its own mutation with no toast. Both say a refusal as a
  // sentence, not as the command's code.
  const mutation = useActionMutation(withGoalRefusals(changeGoalProgramStatus), {
    successMessage: 'Goal status updated',
    errorMessage: actionErrorMessage,
    invalidateKeys: [goalKeys.all],
  })
  const endMutation = useActionMutation(withGoalRefusals(changeGoalProgramStatus), {
    successMessage: 'Goal status updated',
    invalidateKeys: [goalKeys.all],
  })
  const { program, version, versions, assignments } = data
  // Only an active goal is counting. The figure read while it was active stays
  // in the cache after a pause or an end, so it is used only while that holds.
  const counting = program.status === 'active'
  const soFar = useQuery({
    ...goalSoFarQuery(propertyId, goalId),
    enabled: counting,
    retry: false,
  })
  const soFarSubjects = (counting ? soFar.data?.subjects : undefined) ?? []
  const soFarBySubject = new Map(
    soFarSubjects.map(({ subject, progress }) => [goalSubjectKey(subject), progress]),
  )
  const calendar = {
    timezone: version.propertyTimezone,
    now,
    personName: goalPersonNames(members.data?.members),
  }
  const scheduled = program.status === 'scheduled'
  const startsOn = goalDay(goalTargetProvenance(data, version).countsFrom, calendar)
  const currentAssignments = assignments.filter(
    (assignment) => assignment.programVersionId === version.id,
  )
  const results = [...data.results].sort(
    (left, right) => right.periodStart.getTime() - left.periodStart.getTime(),
  )
  const canManage = canDo('goal.update')
  // The month that is running, as the change command would plan it: its own
  // target, and what the months after it are set to.
  const monthPlan = monthTargetPlan(data, now, propData.property.timezone)
  // A status change carries no note from here, so none is stored: the badge
  // says the status. The toast above reports a refusal; settling here keeps it
  // from escaping the click as an unhandled rejection.
  const updateStatus = (status: 'active' | 'paused') => {
    void mutation({ data: { propertyId, programId: goalId, status } }).catch(
      () => undefined,
    )
  }
  const endGoal = () =>
    endMutation({ data: { propertyId, programId: goalId, status: 'ended' } })
  const formatDay = (date: Date): string =>
    formatDate(date, version.propertyTimezone) ?? ''
  const subjectLabel = (subject: GoalSubject) => {
    if (subject.kind === 'property') return propData.property.name
    if (subject.kind === 'portal_group') {
      return (
        subjectNames.groups.find((group) => group.id === subject.portalGroupId)?.name ??
        'Portal group'
      )
    }
    return (
      subjectNames.portals.find((portal) => portal.id === subject.portalId)?.name ??
      'Portal'
    )
  }

  return (
    <PageShell key={`${propertyId}:${goalId}`}>
      <PageHeader
        title={program.name}
        meta={[<StatusBadge key="status" status={program.status} map={GOAL_STATUS} />]}
        description={program.description ?? undefined}
        breadcrumbs={trailCrumbs(
          'goals',
          { propertyId, propertyName: propData.property.name },
          program.name,
        )}
        actions={
          canManage && program.status !== 'ended' ? (
            <>
              <GoalProgramRenameDialog
                renameGoalProgramFn={renameGoalProgram}
                propertyId={propertyId}
                programId={program.id}
                name={program.name}
                description={program.description}
              />
              <GoalProgramAssignmentsDialog
                changeAssignmentsFn={changeGoalProgramAssignments}
                property={{ id: propertyId, name: propData.property.name }}
                programId={program.id}
                currentVersion={version.version}
                propertyTimezone={version.propertyTimezone}
                goal={data}
                assignments={currentAssignments}
                groups={subjectNames.groups}
                portals={subjectNames.portals}
              />
              {monthPlan === null ? null : (
                <GoalMonthTargetDialog
                  changeGoalMonthTargetFn={changeGoalMonthTarget}
                  property={{ id: propertyId, timezone: propData.property.timezone }}
                  goal={data}
                  soFar={soFarSubjects.map(({ subject, progress }) => ({
                    name: subjectLabel(subject),
                    reading: progress.reading,
                  }))}
                />
              )}
              <GoalProgramRevisionDialog
                reviseGoalProgramFn={reviseGoalProgram}
                property={{
                  id: propertyId,
                  name: propData.property.name,
                  timezone: propData.property.timezone,
                }}
                programId={program.id}
                currentVersion={version.version}
                goal={data}
                metric={version.metric}
                targetValue={version.targetValue}
                assignments={currentAssignments}
                groups={subjectNames.groups}
                portals={subjectNames.portals}
              />
              <GoalStatusActions
                goalName={program.name}
                status={program.status}
                pending={mutation.isPending || endMutation.isPending}
                onChange={updateStatus}
                onEnd={endGoal}
              />
            </>
          ) : undefined
        }
      />
      <GoalProgramCard
        goal={data}
        plan={monthPlan}
        subjectCount={currentAssignments.length}
        canManage={canManage}
        frame={calendar}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Monthly results</CardTitle>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {goalNoResultsText({
                scheduled,
                statusReason: program.statusReason,
                startsOn,
              })}
            </p>
          ) : (
            <div className="divide-y">
              {results.map((result) => {
                const assignment = assignments.find(
                  (candidate) => candidate.id === result.assignmentId,
                )
                const resultVersion = versions.find(
                  (candidate) => candidate.id === result.programVersionId,
                )
                const notes =
                  assignment && resultVersion
                    ? goalMonthNotes({
                        metric: resultVersion.metric,
                        result,
                        setAt: goalTargetProvenance(data, resultVersion).setAt,
                        progress:
                          soFarBySubject.get(goalSubjectKey(assignment.subject)) ?? null,
                        marker: monthTargetMarker(data, result, resultVersion),
                        ...calendar,
                      })
                    : []
                return (
                  <div
                    key={result.id}
                    className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {assignment ? subjectLabel(assignment.subject) : 'Subject'}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDay(result.periodStart)} –{' '}
                        {formatDay(new Date(result.periodEnd.getTime() - 1))}
                      </p>
                    </div>
                    <div>
                      <p>
                        {result.evaluation.value ?? '—'} /{' '}
                        {resultVersion
                          ? effectiveMonthTarget(result, resultVersion)
                          : '—'}
                      </p>
                      {notes.map((note) => (
                        <p key={note} className="text-muted-foreground">
                          {note}
                        </p>
                      ))}
                    </div>
                    <StatusBadge
                      {...goalResultStatus(result.evaluation, Boolean(result.revision))}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <GoalTargetChanges goal={data} frame={calendar} />
    </PageShell>
  )
}
