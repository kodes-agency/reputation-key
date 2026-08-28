import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import type { changeGoalProgramAssignments } from '#/contexts/goal/server/goal-programs'
import type { GoalSubjectAssignment } from '#/contexts/goal/application/public-api'
import {
  goalProgramAssignmentEditorSchema,
  type GoalProgramAssignmentEditorInput,
} from '#/contexts/goal/application/dto/goal-program.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { goalKeys } from '#/shared/queries/query-keys'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  GoalSubjectPicker,
  goalSubjectKey,
  goalSubjectsFromKeys,
  type GoalSubjectKey,
} from './goal-subject-picker'
import { GoalAssignmentOutcomes } from './goal-assignment-outcomes'
import { goalAssignmentSubjectLabel } from './goal-assignment-subject-label'
import { GoalSelectAllPortalsField } from './goal-select-all-portals-field'

type Props = Readonly<{
  changeAssignmentsFn: typeof changeGoalProgramAssignments
  property: Readonly<{ id: string; name: string }>
  programId: string
  currentVersion: number
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
  const mutation = useActionMutation(props.changeAssignmentsFn, {
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
          reason: value.reason,
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
    if (next) form.reset(initialFormValues())
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Manage assignments</Button>
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
            <DialogTitle>Manage goal assignments</DialogTitle>
            <DialogDescription>
              Changes start next full month. Current-month targets and results stay
              unchanged.
            </DialogDescription>
          </DialogHeader>
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
          <form.Field name="selectAllCurrentPortals">
            {(field) => (
              <GoalSelectAllPortalsField
                checked={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="reason">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <FieldLabel htmlFor="assignment-change-reason">
                  Reason for the change
                </FieldLabel>
                <Input
                  id="assignment-change-reason"
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
          <FormErrorBanner error={mutation.error} />
          {mutation.data ? (
            <GoalAssignmentOutcomes
              outcomes={mutation.data.outcomes}
              effectiveFrom={mutation.data.effectiveFrom}
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
          <DialogFooter>
            <SubmitButton mutation={mutation} form={form} disabled={!hasRequestedChange}>
              Review and schedule
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
