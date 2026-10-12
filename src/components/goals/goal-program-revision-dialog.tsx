import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
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
import { Alert, AlertDescription } from '#/components/ui/alert'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  goalRevisionDescription,
  goalRevisionReceipt,
  type GoalChangeSource,
  type GoalVersionStart,
} from './goal-revision-start'
import { withGoalRefusals } from './goal-refusal'
import { GoalProgramFormDialog } from './goal-program-form-dialog'
import { GoalChangeReasonField, GoalSubjectsField } from './goal-program-fields'
import { GoalMetricField } from './goal-metric-field'

type GoalProgramRevisionDialogProps = Readonly<{
  reviseGoalProgramFn: typeof reviseGoalProgram
  /** The Property and its own zone: a revision is cut in the zone it has now. */
  property: Readonly<{ id: string; name: string; timezone: string }>
  programId: string
  /** The version the page shows. A goal that changed since refuses the save. */
  currentVersion: number
  /** What the day the revision applies from is read from. */
  goal: GoalChangeSource
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

export function GoalProgramRevisionDialog(props: GoalProgramRevisionDialogProps) {
  const [open, setOpen] = useState(false)
  // The instant the dialog was last opened. The day the revision applies from
  // is worked out from it, so a page left open over the end of a month still
  // says the right month.
  const [openedAt, setOpenedAt] = useState<Date | null>(null)
  // The start the command answered. It stays on screen: after the Property's
  // timezone moved east it is a month later than the next one.
  const [scheduled, setScheduled] = useState<GoalVersionStart | null>(null)
  const mutation = useActionMutation(withGoalRefusals(props.reviseGoalProgramFn), {
    invalidateKeys: [goalKeys.all],
    // The dialog stays open on its receipt, which is the success: no toast.
    onSuccess: ({ version }) => setScheduled(version),
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
          expectedVersion: props.currentVersion,
          ...value,
          reason: value.reason.trim() || undefined,
        },
      })
    },
  })
  const metric = useStore(form.store, (state) => state.values.metric)

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initialFormValues())
      setScheduled(null)
      setOpenedAt(new Date())
    }
    setOpen(next)
  }

  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      trigger="Revise"
      title="Revise goal"
      description={
        openedAt === null
          ? ''
          : goalRevisionDescription(props.goal, openedAt, props.property.timezone)
      }
      onSubmit={() => void submitForm(form)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="metric">
          {(field) => <GoalMetricField id="revision-metric" field={field} />}
        </form.Field>
        <form.Field name="targetValue">
          {(field) => (
            <FormFieldFrame
              id="revision-target"
              label="Monthly target"
              invalid={!field.state.meta.isValid}
              errors={field.state.meta.errors}
            >
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
            </FormFieldFrame>
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
      {scheduled !== null && openedAt !== null ? (
        <Alert variant="success">
          <AlertDescription>{goalRevisionReceipt(scheduled, openedAt)}</AlertDescription>
        </Alert>
      ) : null}
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter>
        {/* The receipt above is the end of it: nothing is left to cancel. */}
        <DialogCancel>{scheduled !== null ? 'Close' : 'Cancel'}</DialogCancel>
        <SubmitButton mutation={mutation} form={form} disabled={scheduled !== null}>
          Schedule revision
        </SubmitButton>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}
