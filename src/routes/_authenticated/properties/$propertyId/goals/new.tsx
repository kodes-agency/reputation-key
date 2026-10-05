import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { createGoalProgram } from '#/contexts/reporting/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
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
import { GoalMetricField } from '#/components/goals/goal-metric-field'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
} from '#/components/goals/goal-subject-picker'
import { prefilledGoalSubjects } from './-goal-subject-prefill'
import {
  createGoalProgramFormSchema,
  type CreateGoalProgramFormInput,
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

// A group's page links here with the group already chosen (`?subject=portal_group:<id>`).
const newGoalSearchSchema = z.object({
  subject: z.string().max(100).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  staticData: { page: { title: 'New Goal', under: 'goals' } },
  validateSearch: newGoalSearchSchema,
  beforeLoad: ({ context, params }) => {
    if (!can((context as AuthRouteContext).role, 'goal.create')) {
      throw roleUnavailable(
        'New Goal',
        { to: `/properties/${params.propertyId}/goals`, label: 'Back to Goals' },
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

function CreateGoalPage() {
  const { propertyId } = Route.useParams()
  const { subject: subjectParam } = Route.useSearch()
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
        },
      })
    },
  })
  const metric = useStore(form.store, (state) => state.values.metric)
  const targetHelp = `Changes take effect from the next complete month in ${propData.property.name}’s timezone.`

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
        onSubmit={submitHandler(form)}
      >
        <Card>
          <CardHeader>
            <CardTitle>Goal program</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <form.Field name="name">
              {(field) => (
                <FormTextField
                  field={field}
                  id="goal-name"
                  label="Name"
                  maxLength={200}
                />
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
                    aria-describedby={describedByOf('goal-target', targetHelp)}
                  />
                </FormFieldFrame>
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
          </CardContent>
          <CardFooter>
            <FormActions error={mutation.error}>
              <SubmitButton mutation={mutation} form={form}>
                Create goal
              </SubmitButton>
            </FormActions>
          </CardFooter>
        </Card>
      </form>
    </PageShell>
  )
}
