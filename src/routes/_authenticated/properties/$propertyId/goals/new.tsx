import { useForm, useStore } from '@tanstack/react-form'
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoalProgram } from '#/contexts/goal/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
} from '#/components/goals/goal-subject-picker'
import {
  createGoalProgramFormSchema,
  type CreateGoalProgramFormInput,
} from '#/contexts/goal/application/dto/goal-program.dto'

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

const METRICS = [
  {
    id: 'qualified_scans' as const,
    label: 'Qualified scans',
    description:
      'Counts eligible portal scans. You can configure this now; results remain scheduled until scan attribution is active.',
  },
  {
    id: 'portal_rating_count' as const,
    label: 'Private rating count',
    description: 'Counts private 1–5 star ratings submitted through the review gateway.',
  },
  {
    id: 'portal_rating_average' as const,
    label: 'Private rating average',
    description:
      'Average private star rating. A monthly result needs at least 10 eligible ratings.',
  },
] as const

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.create')) {
      throw redirect({ to: '/properties' })
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

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: subjects } = useSuspenseQuery(subjectsQuery(propertyId))
  const navigate = useNavigate()
  const mutation = useActionMutation(createGoalProgram, {
    successMessage: 'Goal created',
    invalidateKeys: [goalKeys.all],
    onSuccess: async ({ program }) => {
      await navigate({
        to: '/properties/$propertyId/goals/$goalId',
        params: { propertyId, goalId: program.id },
      })
    },
  })
  const defaultValues: CreateGoalProgramFormInput = {
    name: '',
    description: '',
    metric: 'portal_rating_count',
    targetValue: 0,
    subjects: [],
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
        },
      })
    },
  })
  const metric = useStore(form.store, (state) => state.values.metric)
  const selectedMetric = METRICS.find((candidate) => candidate.id === metric)!

  return (
    <PageShell>
      <PageHeader
        title="New Goal"
        description="Set one monthly target for one or more property, portal-group, or portal subjects."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals', to: `/properties/${propertyId}/goals` },
          { label: 'New Goal' },
        ]}
      />
      <form
        className="grid max-w-5xl gap-4 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Goal program</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <form.Field name="name">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor="goal-name">Name</FieldLabel>
                  <Input
                    id="goal-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={!field.state.meta.isValid}
                    maxLength={200}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor="goal-description">
                    Description (optional)
                  </FieldLabel>
                  <Textarea
                    id="goal-description"
                    value={field.state.value ?? ''}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={!field.state.meta.isValid}
                    maxLength={2_000}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="metric">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor="goal-metric">Metric</FieldLabel>
                  <select
                    id="goal-metric"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(
                        event.target.value as (typeof METRICS)[number]['id'],
                      )
                    }
                    aria-invalid={!field.state.meta.isValid}
                  >
                    {METRICS.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {selectedMetric.description}
                  </p>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="targetValue">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor="goal-target">Monthly target</FieldLabel>
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
                  />
                  <p className="text-xs text-muted-foreground">
                    Changes take effect from the next complete month in{' '}
                    {propData.property.name}’s timezone.
                  </p>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subjects</CardTitle>
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
            <FormErrorBanner error={mutation.error} />
            <SubmitButton mutation={mutation} form={form}>
              Create goal
            </SubmitButton>
          </CardContent>
        </Card>
      </form>
    </PageShell>
  )
}
