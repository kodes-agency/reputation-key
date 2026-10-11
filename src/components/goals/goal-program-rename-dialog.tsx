import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import type { renameGoalProgram } from '#/contexts/reporting/server/goal-program-details'
import { createGoalProgramFormSchema } from '#/contexts/reporting/application/dto/goal-program.dto'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { goalKeys } from '#/shared/queries/query-keys'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { withGoalRefusals } from './goal-refusal'
import { GoalProgramFormDialog } from './goal-program-form-dialog'

// The rules the new-goal form already holds a name and a description to.
const renameGoalFormSchema = z.object({
  name: createGoalProgramFormSchema.shape.name,
  description: createGoalProgramFormSchema.shape.description,
})

type GoalProgramRenameDialogProps = Readonly<{
  renameGoalProgramFn: typeof renameGoalProgram
  propertyId: string
  programId: string
  /** What the goal is called now. */
  name: string
  description: string | null
}>

/**
 * "Edit name": a goal's name and description, changed in place. No version is
 * written and no month moves, so the dialog asks for no note; it saves, says so
 * and closes. Saving what the goal already says sends nothing.
 */
export function GoalProgramRenameDialog(props: GoalProgramRenameDialogProps) {
  const [open, setOpen] = useState(false)
  const mutation = useActionMutation(withGoalRefusals(props.renameGoalProgramFn), {
    successMessage: 'Goal details saved',
    invalidateKeys: [goalKeys.all],
  })
  const initialFormValues = () => ({
    name: props.name,
    description: props.description ?? '',
  })
  const form = useForm({
    defaultValues: initialFormValues(),
    validators: { onSubmit: renameGoalFormSchema },
    onSubmit: async ({ value }) => {
      const name = value.name.trim()
      const description = value.description.trim() || null
      if (name !== props.name || description !== props.description) {
        await mutation({
          data: {
            propertyId: props.propertyId,
            programId: props.programId,
            name,
            // Sent only when it was edited. Left out, the goal keeps the
            // description it has now, which another manager may have changed
            // since this dialog opened.
            ...(description === props.description ? {} : { description }),
          },
        })
      }
      setOpen(false)
    },
  })

  const onOpenChange = (next: boolean) => {
    if (next) form.reset(initialFormValues())
    setOpen(next)
  }

  return (
    <GoalProgramFormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={mutation.isPending}
      trigger="Edit name"
      title="Edit name and description"
      description="This changes what the goal is called. Its target, subjects and results stay as they are."
      onSubmit={() => void submitForm(form)}
    >
      <form.Field name="name">
        {(field) => (
          <FormTextField
            field={field}
            id="goal-rename-name"
            label="Name"
            maxLength={200}
          />
        )}
      </form.Field>
      <form.Field name="description">
        {(field) => (
          <FormTextarea
            field={field}
            id="goal-rename-description"
            label="Description"
            optional
            maxLength={2_000}
          />
        )}
      </form.Field>
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter>
        <DialogCancel />
        <form.Subscribe selector={(state) => state.values.name.trim()}>
          {(name) => (
            <SubmitButton mutation={mutation} form={form} disabled={name === ''}>
              Save changes
            </SubmitButton>
          )}
        </form.Subscribe>
      </DialogFooter>
    </GoalProgramFormDialog>
  )
}
