import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import type { changeGoalProgramAssignments } from '#/contexts/reporting/server/goal-programs'
import type { GoalSubjectAssignment } from '#/contexts/reporting/application/public-api'
import {
  goalProgramAssignmentEditorSchema,
  type GoalProgramAssignmentEditorInput,
} from '#/contexts/reporting/application/dto/goal-program.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { goalKeys } from '#/shared/queries/query-keys'
import { SubmitButton } from '#/components/forms/submit-button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { goalSubjectKey, goalSubjectsFromKeys } from './goal-subject-picker'
import { goalAssignmentsDescription, type GoalChangeSource } from './goal-revision-start'
import { withGoalRefusals } from './goal-refusal'
import { GoalAssignmentOutcomes } from './goal-assignment-outcomes'
import { goalAssignmentSubjectLabel } from './goal-assignment-subject-label'
import { GoalSelectAllPortalsField } from './goal-select-all-portals-field'
import { GoalProgramFormDialog } from './goal-program-form-dialog'
import { GoalChangeReasonField, GoalSubjectsField } from './goal-program-fields'

type Props = Readonly<{
  changeAssignmentsFn: typeof changeGoalProgramAssignments
  property: Readonly<{ id: string; name: string }>
  programId: string
  currentVersion: number
  /** The current version's zone: a change of subjects keeps it, and starts a month there. */
  propertyTimezone: string
  /** What the day the changes apply from is read from. */
  goal: GoalChangeSource
  assignments: readonly GoalSubjectAssignment[]
  groups: readonly Readonly<{
    id: string
    name: string
    portalIds: readonly string[]
  }>[]
  portals: readonly Readonly<{ id: string; name: string }>[]
}>

export function GoalProgramAssignmentsDialog(props: Props) {
  const initialKeys = () =>
    props.assignments.map(({ subject }) => goalSubjectKey(subject))
  const [open, setOpen] = useState(false)
  // The instant the dialog was last opened. The day the changes apply from is
  // worked out from it.
  const [openedAt, setOpenedAt] = useState<Date | null>(null)
  const mutation = useActionMutation(withGoalRefusals(props.changeAssignmentsFn), {
    successMessage: 'Assignment changes reviewed',
    invalidateKeys: [goalKeys.all],
  })
  const initialFormValues = (): GoalProgramAssignmentEditorInput => ({
    subjects: props.assignments.map(({ subject }) => subject),
    selectAllCurrentPortals: false,
    reason: '',
  })
  const form = useForm({
    defaultValues: initialFormValues(),
    validators: { onSubmit: goalProgramAssignmentEditorSchema },
    onSubmit: async ({ value }) => {
      const currentKeys = new Set(initialKeys())
      const selected = value.subjects.map(goalSubjectKey)
      const nextKeys = new Set(selected)
      const add = goalSubjectsFromKeys(selected.filter((key) => !currentKeys.has(key)))
      const remove = goalSubjectsFromKeys(
        [...currentKeys].filter((key) => !nextKeys.has(key)),
      )
      if (!value.selectAllCurrentPortals && add.length + remove.length === 0) return
      await mutation({
        data: {
          propertyId: props.property.id,
          programId: props.programId,
          expectedVersion: props.currentVersion,
          add,
          remove,
          selectAllCurrentPortals: value.selectAllCurrentPortals,
          reason: value.reason.trim() || undefined,
        },
      })
    },
  })
  const values = useStore(form.store, (state) => state.values)
  const selected = values.subjects.map(goalSubjectKey)
  const currentKeys = new Set(initialKeys())
  const nextKeys = new Set(selected)
  const hasRequestedChange =
    values.selectAllCurrentPortals ||
    selected.some((key) => !currentKeys.has(key)) ||
    [...currentKeys].some((key) => !nextKeys.has(key))
  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initialFormValues())
      setOpenedAt(new Date())
    }
    setOpen(next)
  }

  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      trigger="Manage assignments"
      title="Manage goal assignments"
      description={
        openedAt === null
          ? ''
          : goalAssignmentsDescription(props.goal, openedAt, props.propertyTimezone)
      }
      onSubmit={() => void submitForm(form)}
    >
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
      <form.Field name="selectAllCurrentPortals">
        {(field) => (
          <GoalSelectAllPortalsField
            checked={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="reason">
        {(field) => <GoalChangeReasonField field={field} id="assignment-change-reason" />}
      </form.Field>
      {mutation.data && openedAt !== null ? (
        <GoalAssignmentOutcomes
          outcomes={mutation.data.outcomes}
          effectiveFrom={mutation.data.effectiveFrom}
          propertyTimezone={props.propertyTimezone}
          now={openedAt}
          subjectLabel={(subject) =>
            goalAssignmentSubjectLabel(
              subject,
              props.property.name,
              props.groups,
              props.portals,
            )
          }
        />
      ) : null}
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter>
        <DialogCancel />
        <SubmitButton mutation={mutation} form={form} disabled={!hasRequestedChange}>
          Review and schedule
        </SubmitButton>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}
