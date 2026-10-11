import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import type { changeGoalMonthTarget } from '#/contexts/reporting/server/goal-month-target'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import {
  changeGoalMonthTargetFormSchema,
  type ChangeGoalMonthTargetFormInput,
} from '#/contexts/reporting/application/dto/goal-month-target.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { ConsentCheckbox } from '#/components/forms/consent-checkbox'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { FormNumberField } from '#/components/forms/form-number-field'
import { submitForm } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  goalFollowingHelp,
  goalMonthSoFarLines,
  goalMonthTargetDescription,
  goalMonthTargetWords,
  type GoalMonthSoFar,
} from './goal-month-target-dialog-view'
import {
  goalMonthTargetReceipt,
  type GoalMonthTargetReceipt,
} from './goal-month-target-receipt'
import { GoalChangeReasonField } from './goal-program-fields'
import { GoalProgramFormDialog } from './goal-program-form-dialog'
import { withGoalRefusals } from './goal-refusal'

/** The goal as its page read it. */
type Goal = Parameters<typeof monthTargetPlan>[0]

type GoalMonthTargetDialogProps = Readonly<{
  changeGoalMonthTargetFn: typeof changeGoalMonthTarget
  /** The Property and its own zone: a version for the months after is cut in it. */
  property: Readonly<{ id: string; timezone: string }>
  goal: Goal
  /**
   * The month so far of each subject, once it has been read. Empty until then,
   * and for a goal with more subjects than the page reads a figure for.
   */
  soFar: readonly GoalMonthSoFar[]
}>

/**
 * What the dialog was opened on: the instant, the running month as the command
 * would plan it then (null when none runs), and the version the goal had. The
 * save sends these back, so a goal that moved on while the dialog was open
 * refuses it, also when the page behind has read the goal again meanwhile.
 */
type Opened = Readonly<{
  at: Date
  plan: ReturnType<typeof monthTargetPlan>
  version: number
}>
type OpenedOnMonth = Opened & Readonly<{ plan: NonNullable<Opened['plan']> }>

const TITLE = 'Change this month’s target'

/**
 * "Change this month's target": the target of the month that is running, and,
 * unless the manager says otherwise, of the months after it. The clock is read
 * when the dialog opens, so a page left open over the end of a month does not
 * offer the month it showed.
 */
export function GoalMonthTargetDialog(props: GoalMonthTargetDialogProps) {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState<Opened | null>(null)
  const onOpenChange = (next: boolean) => {
    if (next) {
      const at = new Date()
      setOpened({
        at,
        plan: monthTargetPlan(props.goal, at, props.property.timezone),
        version: props.goal.program.currentVersion,
      })
    }
    setOpen(next)
  }
  if (opened !== null && opened.plan !== null) {
    return (
      <MonthTargetForm
        // A form of its own for every opening: it starts from what that
        // opening read, with no receipt or refusal left from the one before.
        key={opened.at.getTime()}
        {...props}
        opened={{ ...opened, plan: opened.plan }}
        open={open}
        onOpenChange={onOpenChange}
      />
    )
  }
  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={false}
      trigger={TITLE}
      title={TITLE}
      description={opened === null ? '' : goalMonthTargetDescription(null)}
      onSubmit={() => undefined}
    >
      <DialogFooter>
        <DialogCancel>Close</DialogCancel>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}

/**
 * The form of one opening. The checkbox names the real day the months after
 * start, and says what ticking it would replace or leave out, from the plan
 * the command itself works from.
 */
function MonthTargetForm({
  opened,
  open,
  onOpenChange,
  ...props
}: GoalMonthTargetDialogProps &
  Readonly<{
    opened: OpenedOnMonth
    open: boolean
    onOpenChange: (open: boolean) => void
  }>) {
  const { plan } = opened
  const frame = { timezone: props.property.timezone, now: opened.at }
  const words = goalMonthTargetWords(plan, frame)
  const { metric } = plan.inForceVersion
  const average = metric === 'portal_rating_average'
  // What the command answered. It stays on screen and is the only word on the
  // success: the months after can be left as they were while the month changes.
  const [receipt, setReceipt] = useState<GoalMonthTargetReceipt | null>(null)
  const mutation = useActionMutation(
    // The dialog knows which month it showed, so it names it.
    withGoalRefusals(props.changeGoalMonthTargetFn, {
      month_locked: `${words.month} has ended. Its target can’t be changed.`,
    }),
    {
      invalidateKeys: [goalKeys.all],
      // The dialog stays open on its receipt, which is the success: no toast.
      onSuccess: (result) =>
        setReceipt(
          goalMonthTargetReceipt(result, {
            ...frame,
            month: words.month,
            followingMonth: words.followingMonth,
            portalsOnly: props.goal.assignments.every(
              (assignment) => assignment.subject.kind === 'portal',
            ),
          }),
        ),
    },
  )
  const defaultValues: ChangeGoalMonthTargetFormInput = {
    targetValue: plan.effectiveTarget,
    applyToFollowing: words.following.defaultChecked,
    note: '',
  }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: changeGoalMonthTargetFormSchema(metric) },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          propertyId: props.property.id,
          programId: props.goal.program.id,
          month: plan.monthKey,
          targetValue: value.targetValue,
          expectedTarget: plan.effectiveTarget,
          expectedVersion: opened.version,
          applyToFollowing: words.following.available && value.applyToFollowing,
          note: value.note.trim() || undefined,
        },
      })
    },
  })
  const typedTarget = useStore(form.store, (state) => state.values.targetValue)
  const soFar = goalMonthSoFarLines(metric, props.soFar)
  // One subject's figure sits under the field as its help; several are a list.
  const oneSubject = props.soFar.length === 1

  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      trigger={TITLE}
      title={TITLE}
      description={goalMonthTargetDescription(words)}
      onSubmit={() => void submitForm(form)}
    >
      <form.Field name="targetValue">
        {(field) => (
          <FormNumberField
            id="month-target-value"
            label={words.fieldLabel}
            min={1}
            max={average ? 5 : undefined}
            step={average ? 0.1 : undefined}
            field={field}
            description={oneSubject ? soFar[0] : undefined}
          />
        )}
      </form.Field>
      {soFar.length > 0 && !oneSubject ? (
        <ul className="text-sm text-muted-foreground">
          {soFar.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <form.Field name="applyToFollowing">
        {(field) => (
          <ConsentCheckbox
            id="month-target-following"
            checked={words.following.available && field.state.value}
            disabled={!words.following.available}
            onCheckedChange={field.handleChange}
            description={goalFollowingHelp(plan, typedTarget, frame) ?? undefined}
          >
            {words.following.label}
          </ConsentCheckbox>
        )}
      </form.Field>
      <form.Field name="note">
        {(field) => <GoalChangeReasonField field={field} id="month-target-note" />}
      </form.Field>
      {receipt === null ? null : (
        <Alert variant={receipt.tone}>
          <AlertDescription>{receipt.text}</AlertDescription>
        </Alert>
      )}
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter>
        {/* The receipt above is the end of it: nothing is left to cancel. */}
        <DialogCancel>{receipt === null ? 'Cancel' : 'Close'}</DialogCancel>
        <SubmitButton
          mutation={mutation}
          form={form}
          pendingLabel="Saving…"
          disabled={receipt !== null}
        >
          Save target
        </SubmitButton>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}
