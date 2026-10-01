// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// The body of the "Add portals" dialog on a group's page: the property's other
// portals, grouped by where they are now. Choosing one that is in another group
// moves it, and the checklist says so. Each portal is its own atomic move, run
// one after another; the first refusal stops the rest and is shown.
import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'
import { addPortalsToGroupFormSchema } from '#/contexts/portal/application/dto/portal-group-membership.dto'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupChecklistField } from './portal-group-checklist-field'
import { buildPortalChecklist, describeSelection } from './portal-group-checklist'
import type { PortalGroupMutations } from './portal-group-mutations'

type Props = Readonly<{
  groupId: string
  rows: readonly PortalOverviewRow[]
  mutation: PortalGroupMutations['movePortalMutation']
  onDone: () => void
}>

export function PortalGroupAddForm({ groupId, rows, mutation, onDone }: Props) {
  const sections = buildPortalChecklist(rows, { addingToGroupId: groupId })
  const form = useForm({
    defaultValues: { portalIds: [] as string[] },
    validators: { onSubmit: addPortalsToGroupFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = addPortalsToGroupFormSchema.parse(value)
      const moved: string[] = []
      try {
        for (const portalId of parsed.portalIds) {
          await mutation({ data: { portalGroupId: groupId, portalId } })
          moved.push(portalId)
        }
      } catch (error) {
        // The ones that moved are in the group now: leave only the rest ticked,
        // so trying again does not move a portal that is already here.
        form.setFieldValue(
          'portalIds',
          parsed.portalIds.filter((portalId) => !moved.includes(portalId)),
        )
        throw error
      }
      onDone()
    },
  })

  return (
    <form className="grid min-h-0 gap-4" onSubmit={submitHandler(form)}>
      <form.Field name="portalIds">
        {(field) => (
          <PortalGroupChecklistField
            label="Portals to add"
            sections={sections}
            selected={field.state.value}
            disabled={mutation.isPending}
            onChange={(next) => field.handleChange([...next])}
          />
        )}
      </form.Field>
      {/* A refusal from an earlier time the dialog was open is not shown again. */}
      <form.Subscribe selector={(state) => state.submissionAttempts}>
        {(attempts) => (attempts > 0 ? <FormErrorBanner error={mutation.error} /> : null)}
      </form.Subscribe>
      <DialogFooter className="items-center sm:justify-between">
        <form.Subscribe selector={(state) => state.values.portalIds.length}>
          {(count) => (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {describeSelection(count)}
            </p>
          )}
        </form.Subscribe>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <form.Subscribe selector={(state) => state.values.portalIds.length}>
            {(count) => (
              <SubmitButton mutation={mutation} form={form} disabled={count === 0}>
                Add to group
              </SubmitButton>
            )}
          </form.Subscribe>
        </div>
      </DialogFooter>
    </form>
  )
}
