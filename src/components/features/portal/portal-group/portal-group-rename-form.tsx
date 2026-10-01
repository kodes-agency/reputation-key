// The body of the "Rename group" dialog: one name, checked against the same rule
// the server applies.
import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'
import { updatePortalGroupInputSchema } from '#/contexts/portal/application/dto/update-portal-group.dto'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'

const renameGroupFormSchema = updatePortalGroupInputSchema.pick({ name: true }).required()

type Props = Readonly<{
  group: PortalGroupRef
  mutation: PortalGroupMutations['renameMutation']
  onDone: () => void
}>

export function PortalGroupRenameForm({ group, mutation, onDone }: Props) {
  const form = useForm({
    defaultValues: { name: group.name },
    validators: { onSubmit: renameGroupFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = renameGroupFormSchema.parse(value)
      if (parsed.name !== group.name) {
        await mutation({ data: { portalGroupId: group.id, name: parsed.name } })
      }
      onDone()
    },
  })

  return (
    <form className="grid gap-4" onSubmit={submitHandler(form)}>
      <form.Field name="name">
        {(field) => (
          <FormTextField
            field={field}
            id={`portal-group-rename-${group.id}`}
            label="Name"
            maxLength={100}
            disabled={mutation.isPending}
          />
        )}
      </form.Field>
      {/* A refusal from an earlier time the dialog was open is not shown again. */}
      <form.Subscribe selector={(state) => state.submissionAttempts}>
        {(attempts) => (attempts > 0 ? <FormErrorBanner error={mutation.error} /> : null)}
      </form.Subscribe>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => state.values.name.trim()}>
          {(name) => (
            <SubmitButton mutation={mutation} form={form} disabled={name === ''}>
              Save name
            </SubmitButton>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
