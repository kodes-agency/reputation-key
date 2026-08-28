import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import type { reviseGoalProgram } from '#/contexts/goal/server/goal-programs'
import type {
  GoalMetric,
  GoalSubject,
  GoalSubjectAssignment,
} from '#/contexts/goal/application/public-api'
import {
  reviseGoalProgramFormSchema,
  type ReviseGoalProgramFormInput,
} from '#/contexts/goal/application/dto/goal-program.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from './goal-subject-picker'

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
  const mutation = useActionMutation(props.reviseGoalProgramFn, {
    successMessage: 'Goal revision scheduled for the next full month',
    invalidateKeys: [goalKeys.all],
    onSuccess: () => setOpen(false),
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
    if (next) form.reset(initialFormValues())
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Revise</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Revise goal</DialogTitle>
            <DialogDescription>
              The current month remains unchanged. This version starts with the next
              complete month.
            </DialogDescription>
          </DialogHeader>
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
                    onChange={(event) =>
                      field.handleChange(event.target.value as GoalMetric)
                    }
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
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <FieldLabel htmlFor="revision-reason">Reason for the change</FieldLabel>
                <Input
                  id="revision-reason"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                  maxLength={500}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <form.Field name="subjects">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <GoalSubjectPicker
                  property={props.property}
                  groups={props.groups}
                  portals={props.portals}
                  selected={field.state.value.map(goalSubjectKey)}
                  onChange={(keys: GoalSubjectKey[]) =>
                    field.handleChange(goalSubjectsFromKeys(keys))
                  }
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <FormErrorBanner error={mutation.error} />
          <DialogFooter>
            <SubmitButton mutation={mutation} form={form}>
              Schedule revision
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
