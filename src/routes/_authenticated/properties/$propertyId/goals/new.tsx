import { lazy, Suspense, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import {
  createGoalProgram,
  listGoalPrograms,
  previewGoalMonth,
} from '#/contexts/reporting/server/goal-programs'
import type { GoalMetric, GoalSubject } from '#/contexts/reporting/application/public-api'
import { subjectHolds } from '#/contexts/reporting/application/goal-subject-holds'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Field, FieldError } from '#/components/ui/field'
import { FormActions } from '#/components/forms/form-actions'
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { goalAssignmentSubjectLabel } from '#/components/goals/goal-assignment-subject-label'
import { GoalBulkPending } from '#/components/goals/goal-bulk-pending'
import { goalCreateRefusal } from '#/components/goals/goal-create-refusal'
import { GoalMetricField } from '#/components/goals/goal-metric-field'
import { GoalNewTabs } from '#/components/goals/goal-new-tabs'
import { goalRefusalCode } from '#/components/goals/goal-refusal'
import { goalSoFarLine } from '#/components/goals/goal-so-far'
import { GoalStartField } from '#/components/goals/goal-start-field'
import {
  goalStartChoice,
  goalStartLabels,
  offeredStartMonth,
  type GoalStartChoice,
} from '#/components/goals/goal-start-view'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
} from '#/components/goals/goal-subject-picker'
import { newGoalSearchSchema } from './-goal-new-search'
import { prefilledGoalSubjects } from './-goal-subject-prefill'
import {
  createGoalProgramFormSchema,
  type CreateGoalProgramFormInput,
  type CreateGoalProgramInput,
} from '#/contexts/reporting/application/dto/goal-program.dto'

const subjectsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.goalSubjects(propertyId),
    queryFn: async () => {
      const [groups, portals] = await Promise.all([
        listPortalGroups({ data: { propertyId } }),
        listPortals({ data: { propertyId } }),
      ])
      return { groups: groups.groups, portals: portals.portals }
    },
  })

const SIDE_READ_STALE_MS = 30_000

// The month so far for one subject and measure, before its goal exists: the
// same governed read a goal's own month to date uses, and never a result.
const monthPreviewQuery = (
  propertyId: string,
  metric: GoalMetric,
  subject: GoalSubject,
) =>
  queryOptions({
    queryKey: goalKeys.monthPreview(propertyId, metric, goalSubjectKey(subject)),
    queryFn: () => previewGoalMonth({ data: { propertyId, metric, subject } }),
    staleTime: SIDE_READ_STALE_MS,
  })

// The Property's goals, to say which goal holds a subject: read by the single
// goal form only once the command has refused one, and by the table that sets
// several goals before it draws a row. The Goals page shares the key, so it is
// usually cached.
const heldGoalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: SIDE_READ_STALE_MS,
  })

/** What the command last refused, kept so its banner speaks of that attempt. */
type RefusedGoal = Pick<CreateGoalProgramInput, 'metric' | 'subjects' | 'startMonth'>

/**
 * The month so far for the one subject of a goal that starts this month, in
 * words. A goal that starts this month counts from its first day, so the form
 * says what has already counted before the target is saved. A side read: it
 * never holds the form back, and a failure says nothing.
 */
function useMonthSoFar(
  input: Readonly<{
    propertyId: string
    metric: GoalMetric
    subjects: readonly GoalSubject[]
    startsThisMonth: boolean
  }>,
): string | null {
  const { propertyId, metric } = input
  const [onlySubject] = input.subjects.length === 1 ? input.subjects : []
  const enabled = input.startsThisMonth && onlySubject !== undefined
  const preview = useQuery({
    // Never run without exactly one subject; the Property only fills the key.
    ...monthPreviewQuery(
      propertyId,
      metric,
      onlySubject ?? { kind: 'property', propertyId },
    ),
    enabled,
    retry: false,
  })
  return enabled && preview.data
    ? goalSoFarLine(metric, preview.data.preview.reading)
    : null
}

/**
 * What the banner says about the command's last refusal. A refused subject is
 * explained from the Property's goals, which are read only then; any failure
 * the form has no words for is handed on as it is.
 */
function useCreateRefusal(
  input: Readonly<{
    propertyId: string
    error: unknown
    refused: RefusedGoal | null
    start: GoalStartChoice
    subjectName: (subject: GoalSubject) => string
    timezone: string
    now: Date
  }>,
): unknown {
  const { error, refused, start } = input
  const heldGoals = useQuery({
    ...heldGoalsQuery(input.propertyId),
    enabled: goalRefusalCode(error) === 'subject_has_goal',
    retry: false,
  })
  if (refused === null) return error
  const refusedStart = [start.current, start.next].find(
    (option) => option.monthKey === refused.startMonth,
  )
  return goalCreateRefusal(error, {
    subjects: refused.subjects,
    holds:
      heldGoals.data && refusedStart
        ? subjectHolds(heldGoals.data.programs, refused.metric, refusedStart.period.start)
        : [],
    startsThisMonth: refused.startMonth === start.current.monthKey,
    subjectName: input.subjectName,
    timezone: input.timezone,
    now: input.now,
  })
}

// The table that sets several goals, with its fields and its rules: a chunk of
// its own, loaded only when that view is opened.
const GoalBulkTable = lazy(() =>
  import('#/components/goals/goal-bulk-table').then((module) => ({
    default: module.GoalBulkTable,
  })),
)

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  staticData: { page: { title: 'New goal', under: 'goals' } },
  validateSearch: newGoalSearchSchema,
  beforeLoad: ({ context, params }) => {
    if (!can((context as AuthRouteContext).role, 'goal.create')) {
      throw roleUnavailable(
        'New goal',
        { to: `/properties/${params.propertyId}/goals`, label: 'Back to goals' },
        'this page',
      )
    }
  },
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(propertyQuery(propertyId)),
      context.queryClient.ensureQueryData(subjectsQuery(propertyId)),
    ])
  },
  component: CreateGoalPage,
})

/**
 * The two months a goal may start in, and the instant they were worked out at.
 *
 * That instant is when this route last loaded, which the router records, sends
 * with the server render and renews when the loader runs again. The months are
 * worked out from it, so the server and the browser offer the same ones, and
 * reading them again is running the loader again. The loader itself returns
 * nothing: its code is part of the first-paint bundle, and the calendar code
 * stays with the page.
 */
function useStartMonths(timezone: string) {
  const loadedAt = Route.useMatch({ select: (match) => match.updatedAt })
  const router = useRouter()
  const now = new Date(loadedAt)
  return {
    now,
    start: goalStartChoice(now, timezone),
    /** The month changed while the page was open: read the two months again. */
    readAgain: () =>
      void router.invalidate({ filter: (match) => match.routeId === Route.id }),
  }
}

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { subject, mode } = Route.useSearch()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const several = mode === 'several'
  const breadcrumbs = trailCrumbs(
    'goals',
    { propertyId, propertyName: propData.property.name },
    'New goal',
  )
  return (
    <PageShell>
      {several ? (
        <PageHeader title="New goal" breadcrumbs={breadcrumbs} />
      ) : (
        <PageHeader
          title="New goal"
          description="Set one monthly target for one or more property, portal-group, or portal subjects."
          breadcrumbs={breadcrumbs}
        />
      )}
      <div className="flex flex-col gap-4">
        <GoalNewTabs
          propertyId={propertyId}
          view={several ? 'several' : 'one'}
          subject={subject}
        />
        {several ? (
          // The boundary is around the whole view, not the table alone: the
          // read of the goals then starts once the table's chunk is here, so
          // its answer never reaches a boundary that is still hydrating.
          <Suspense fallback={<GoalBulkPending />}>
            <SeveralGoals propertyId={propertyId} />
          </Suspense>
        ) : (
          <OneGoalForm />
        )}
      </div>
    </PageShell>
  )
}

/**
 * Set goals for several portals: one number per Portal or Portal Group, each
 * its own goal. The Property's goals are read here and not in the loader,
 * whose code is part of the first-paint bundle: only this view needs them
 * before it draws, and the table says so while they are on their way.
 */
function SeveralGoals({ propertyId }: Readonly<{ propertyId: string }>) {
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: subjects } = useSuspenseQuery(subjectsQuery(propertyId))
  const goals = useQuery(heldGoalsQuery(propertyId))
  const { timezone } = propData.property
  const { now, start, readAgain } = useStartMonths(timezone)
  return (
    <GoalBulkTable
      createGoalsForSubjectsFn={createGoalsForSubjects}
      property={{ id: propertyId, timezone }}
      groups={subjects.groups}
      portals={subjects.portals}
      programs={goals.data?.programs}
      goalsRead={{
        failed: hasFailed(goals),
        retrying: isRetrying(goals),
        onRetry: () => void goals.refetch(),
      }}
      start={start}
      now={now}
      onMonthChanged={readAgain}
    />
  )
}

function OneGoalForm() {
  const { propertyId } = Route.useParams()
  const { subject: subjectParam } = Route.useSearch()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: subjects } = useSuspenseQuery(subjectsQuery(propertyId))
  const navigate = useNavigate()
  const { timezone } = propData.property
  const { now, start, readAgain } = useStartMonths(timezone)
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  const startMonth = offeredStartMonth(start, pickedMonth)
  const startLabels = goalStartLabels(start, timezone, now)
  const [refused, setRefused] = useState<RefusedGoal | null>(null)
  const mutation = useActionMutation(createGoalProgram, {
    successMessage: 'Goal created',
    invalidateKeys: [goalKeys.all],
    onSuccess: async ({ program }) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: program.id },
      })
    },
    onError: (error, { data }) => {
      setRefused(data)
      if (goalRefusalCode(error) === 'start_month_changed') readAgain()
    },
  })
  const defaultValues: CreateGoalProgramFormInput = {
    name: '',
    description: '',
    metric: 'portal_rating_count',
    targetValue: 0,
    subjects: [
      ...prefilledGoalSubjects(subjectParam, {
        propertyId,
        groupIds: subjects.groups.map((group) => group.id),
        portalIds: subjects.portals.map((portal) => portal.id),
      }),
    ],
  }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: createGoalProgramFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          propertyId,
          ...value,
          description: value.description?.trim() || null,
          startMonth,
        },
      })
    },
  })
  const metric = useStore(form.store, (state) => state.values.metric)
  const chosenSubjects = useStore(form.store, (state) => state.values.subjects)
  const targetHelp = `Months follow ${propData.property.name}’s time zone.`

  const soFar = useMonthSoFar({
    propertyId,
    metric,
    subjects: chosenSubjects,
    startsThisMonth: startMonth === start.current.monthKey,
  })
  const refusal = useCreateRefusal({
    propertyId,
    error: mutation.error,
    refused,
    start,
    subjectName: (subject) =>
      goalAssignmentSubjectLabel(
        subject,
        propData.property.name,
        subjects.groups,
        subjects.portals,
      ),
    timezone,
    now,
  })

  return (
    <form className="grid max-w-5xl gap-4 lg:grid-cols-2" onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Goal program</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form.Field name="name">
            {(field) => (
              <FormTextField field={field} id="goal-name" label="Name" maxLength={200} />
            )}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <FormTextarea
                field={field}
                id="goal-description"
                label="Description"
                optional
                maxLength={2_000}
              />
            )}
          </form.Field>
          <form.Field name="metric">
            {(field) => (
              <GoalMetricField id="goal-metric" field={field} withDescription />
            )}
          </form.Field>
          <form.Field name="targetValue">
            {(field) => (
              <FormFieldFrame
                id="goal-target"
                label="Monthly target"
                description={targetHelp}
                invalid={!field.state.meta.isValid}
                errors={field.state.meta.errors}
              >
                <Input
                  id="goal-target"
                  type="number"
                  min="1"
                  max={metric === 'portal_rating_average' ? 5 : undefined}
                  step={metric === 'portal_rating_average' ? 0.1 : 1}
                  value={field.state.value === 0 ? '' : field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(
                      event.target.value === '' ? 0 : Number(event.target.value),
                    )
                  }
                  aria-invalid={!field.state.meta.isValid}
                  aria-describedby={describedByOf(
                    'goal-target',
                    targetHelp,
                    !field.state.meta.isValid,
                  )}
                />
              </FormFieldFrame>
            )}
          </form.Field>
          <GoalStartField
            options={[
              { monthKey: start.current.monthKey, label: startLabels.current },
              { monthKey: start.next.monthKey, label: startLabels.next },
            ]}
            value={startMonth}
            onValueChange={setPickedMonth}
            soFar={soFar}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Subjects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form.Field name="subjects">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <GoalSubjectPicker
                  property={{ id: propertyId, name: propData.property.name }}
                  groups={subjects.groups}
                  portals={subjects.portals}
                  selected={field.state.value.map(goalSubjectKey)}
                  onChange={(keys) => field.handleChange(goalSubjectsFromKeys(keys))}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </CardContent>
        <CardFooter>
          <FormActions error={refusal}>
            <SubmitButton mutation={mutation} form={form}>
              Create goal
            </SubmitButton>
          </FormActions>
        </CardFooter>
      </Card>
    </form>
  )
}
