import { useForm } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { updatePortalGroupInputSchema } from '#/contexts/portal/application/dto/update-portal-group.dto'
import type { PortalGroupMutations } from './portal-group-types'
import { PortalGroupNameField } from './portal-group-name-field'

const renamePortalGroupFormSchema = updatePortalGroupInputSchema
  .pick({ name: true })
  .required()

export function PortalGroupRenameForm({
  groupId,
  initialName,
  mutation,
  onSaved,
  onCancel,
}: Readonly<{
  groupId: string
  initialName: string
  mutation: PortalGroupMutations['updateMutation']
  onSaved: () => void
  onCancel: () => void
}>) {
  const form = useForm({
    defaultValues: { name: initialName },
    validators: { onSubmit: renamePortalGroupFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = renamePortalGroupFormSchema.parse(value)
      await mutation({ data: { portalGroupId: groupId, name: parsed.name } })
      onSaved()
    },
  })

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <form.Field name="name">
        {(field) => (
          <PortalGroupNameField
            field={field}
            id={`portal-group-name-${groupId}`}
            label="Group name"
            disabled={mutation.isPending}
            labelHidden
            autoFocus
          />
        )}
      </form.Field>
      <div className="flex gap-2">
        <form.Subscribe selector={(state) => state.values.name}>
          {(name) => (
            <Button type="submit" size="sm" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
