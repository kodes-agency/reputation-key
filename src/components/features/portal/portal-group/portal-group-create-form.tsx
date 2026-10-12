// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// The body of the "New group" dialog (board 12): a name and the portals to
// start with. A portal that is in another group moves, and the checklist says
// so under it. The create call does all of it in one commit.
import { useForm } from '@tanstack/react-form'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { Label } from '#/components/ui/label'
import { createPortalGroupInputSchema } from '#/contexts/portal/application/dto/create-portal-group.dto'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupChecklistField } from './portal-group-checklist-field'
import { buildPortalChecklist, describeSelection } from './portal-group-checklist'
import type { PortalGroupMutations } from './portal-group-mutations'

const createGroupFormSchema = createPortalGroupInputSchema
  .pick({ name: true, portalIds: true })
  .required()

type Props = Readonly<{
  propertyId: string
  /** Every portal of the property, with the group each is in now. */
  rows: readonly PortalOverviewRow[]
  mutation: PortalGroupMutations['createMutation']
  onDone: () => void
}>

export function PortalGroupCreateForm({ propertyId, rows, mutation, onDone }: Props) {
  const sections = buildPortalChecklist(rows)
  const form = useForm({
    defaultValues: { name: '', portalIds: [] as string[] },
    validators: { onSubmit: createGroupFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = createGroupFormSchema.parse(value)
      await mutation({
        data: { propertyId, name: parsed.name, portalIds: parsed.portalIds },
      })
      onDone()
    },
  })

  return (
    <form className="grid min-h-0 gap-4" onSubmit={submitHandler(form)}>
      <form.Field name="name">
        {(field) => (
          <FormTextField
            field={field}
            id="portal-group-name"
            label="Name"
            maxLength={100}
            disabled={mutation.isPending}
          />
        )}
      </form.Field>
      <div className="grid min-h-0 gap-2">
        <Label>Portals</Label>
        <form.Field name="portalIds">
          {(field) => (
            <PortalGroupChecklistField
              label="Portals"
              sections={sections}
              selected={field.state.value}
              disabled={mutation.isPending}
              onChange={(next) => field.handleChange([...next])}
            />
          )}
        </form.Field>
      </div>
      <DialogErrorBanner error={mutation.error} />
      <form.Subscribe selector={(state) => state.values.portalIds.length}>
        {(count) => (
          <DialogFooter note={<span aria-live="polite">{describeSelection(count)}</span>}>
            <DialogCancel />
            <form.Subscribe selector={(state) => state.values.name.trim()}>
              {(name) => (
                <SubmitButton mutation={mutation} form={form} disabled={name === ''}>
                  Create group
                </SubmitButton>
              )}
            </form.Subscribe>
          </DialogFooter>
        )}
      </form.Subscribe>
    </form>
  )
}
