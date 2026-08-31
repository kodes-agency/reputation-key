import { useForm } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { createPortalGroupInputSchema } from '#/contexts/portal/application/dto/create-portal-group.dto'
import type { PortalGroupMutations } from './portal-group-types'
import { PortalGroupNameField } from './portal-group-name-field'

const createPortalGroupFormSchema = createPortalGroupInputSchema
  .pick({ name: true })
  .required()

export function PortalGroupCreateForm({
  propertyId,
  mutation,
  onCreated,
}: Readonly<{
  propertyId: string
  mutation: PortalGroupMutations['createMutation']
  onCreated: () => void
}>) {
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: createPortalGroupFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = createPortalGroupFormSchema.parse(value)
      await mutation({ data: { propertyId, name: parsed.name } })
      form.reset()
      onCreated()
    },
  })

  return (
    <form
      id="create-portal-group-form"
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <form.Field name="name">
        {(field) => (
          <PortalGroupNameField
            field={field}
            id="portal-group-name"
            label="Group name"
            disabled={mutation.isPending}
            autoFocus
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.name}>
        {(name) => (
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create group'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
