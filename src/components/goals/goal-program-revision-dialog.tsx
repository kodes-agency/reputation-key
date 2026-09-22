import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { reviseGoalProgram } from '#/contexts/reporting/server/goal-programs'
import type {
  GoalMetric,
  GoalSubject,
  GoalSubjectAssignment,
} from '#/contexts/reporting/application/public-api'
import {
  reviseGoalProgramFormSchema,
  type ReviseGoalProgramFormInput,
} from '#/contexts/reporting/application/dto/goal-program.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { DialogFooter } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  goalRevisionScheduledMessage,
  goalRevisionStartDate,
  type GoalVersionStart,
} from './goal-revision-start'
import { GoalProgramFormDialog } from './goal-program-form-dialog'
import { GoalChangeReasonField, GoalSubjectsField } from './goal-program-fields'

type GoalProgramRevisionDialogProps = Readonly<{
  reviseGoalProgramFn: typeof reviseGoalProgram
  property: Readonly<{ id: string; name: string }>
  programId: string
  metric: GoalMetric
  targetValue: number
  assignments: readonly GoalSubjectAssignment[]
  groups: readonly Readonly<{
    id: string
    name: string
    portalIds: readonly string[]
  }>[]
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

const METRICS: readonly Readonly<{ id: GoalMetric; label: string }>[] = [
  { id: 'qualified_scans', label: 'Qualified scans' },
  { id: 'portal_rating_count', label: 'Private rating count' },
  { id: 'portal_rating_average', label: 'Private rating average' },
]

export function GoalProgramRevisionDialog(props: GoalProgramRevisionDialogProps) {
  const [open, setOpen] = useState(false)
  // The start the server chose. It stays on screen: after the Property's
  // timezone moved east it is a month later than "next month".
  const [scheduled, setScheduled] = useState<GoalVersionStart | null>(null)
  const mutation = useActionMutation(props.reviseGoalProgramFn, {
    invalidateKeys: [goalKeys.all],
    onSuccess: ({ version }) => {
      setScheduled(version)
      toast.success(goalRevisionScheduledMessage(version))
    },
  })
  const initialFormValues = (): ReviseGoalProgramFormInput => ({
    metric: props.metric,
    targetValue: props.targetValue,
    reason: '',
    subjects: props.assignments.map(({ subject }) => subject) as GoalSubject[],
  })
  const form = useForm({
    defaultValues: initialFormValues(),
    validators: { onSubmit: reviseGoalProgramFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          propertyId: props.property.id,
          programId: props.programId,
          ...value,
        },
      })
    },
  })
  const metric = useStore(form.store, (state) => state.values.metric)

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initialFormValues())
      setScheduled(null)
    }
    setOpen(next)
  }

  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger="Revise"
      title="Revise goal"
      description="The month in progress keeps the current version. This version starts with the first full month in the Property's timezone that begins after it ends."
      onSubmit={() => void submitForm(form)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="metric">
          {(field) => (
            <Field data-invalid={!field.state.meta.isValid}>
              <FieldLabel htmlFor="revision-metric">Metric</FieldLabel>
              <select
                id="revision-metric"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value as GoalMetric)}
                aria-invalid={!field.state.meta.isValid}
              >
                {METRICS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="targetValue">
          {(field) => (
            <Field data-invalid={!field.state.meta.isValid}>
              <FieldLabel htmlFor="revision-target">Monthly target</FieldLabel>
              <Input
                id="revision-target"
                type="number"
                min="1"
                max={metric === 'portal_rating_average' ? 5 : undefined}
                step={metric === 'portal_rating_average' ? 0.1 : 1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(Number(event.target.value))}
                aria-invalid={!field.state.meta.isValid}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </div>
      <form.Field name="reason">
        {(field) => <GoalChangeReasonField field={field} id="revision-reason" />}
      </form.Field>
      <form.Field name="subjects">
        {(field) => (
          <GoalSubjectsField
            field={field}
            property={props.property}
            groups={props.groups}
            portals={props.portals}
          />
        )}
      </form.Field>
      <FormErrorBanner error={mutation.error} />
      {scheduled ? (
        <p role="status" className="rounded-md bg-muted/50 p-3 text-sm">
          {`Revision scheduled. This version starts ${goalRevisionStartDate(scheduled)} (${scheduled.propertyTimezone}).`}
        </p>
      ) : null}
      <DialogFooter>
        <SubmitButton mutation={mutation} form={form} disabled={scheduled !== null}>
          Schedule revision
        </SubmitButton>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}
