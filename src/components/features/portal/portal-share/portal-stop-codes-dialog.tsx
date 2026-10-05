// "Stop all codes?": a reason, then the public address stops at once. A
// confirmation with one required field, so it is the shared shell with the field
// as its body; the dialog stays open while the codes stop and says a refusal in
// place.
import { useForm, useStore } from '@tanstack/react-form'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { revokePortalTokensInputSchema } from '#/contexts/portal/application/dto/portal-token-lifecycle.dto'
import type { PortalShareMutations } from './portal-share-types'

const revokeLinksFormSchema = revokePortalTokensInputSchema
  .pick({ reason: true })
  .required()

export function PortalStopCodesDialog({
  open,
  onOpenChange,
  portalId,
  mutation,
  onStopped,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  mutation: PortalShareMutations['revokeMutation']
  onStopped: () => void
}>) {
  const form = useForm({
    defaultValues: { reason: '' },
    validators: { onSubmit: revokeLinksFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = revokeLinksFormSchema.parse(value)
      await mutation({ data: { portalId, reason: parsed.reason } })
      onStopped()
    },
  })
  const reason = useStore(form.store, (state) => state.values.reason)

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      // Empty again once it has gone, not while it fades.
      onCloseAutoFocus={() => form.reset()}
      tone="destructive"
      title="Stop all codes?"
      description="The public address stops working at once, including a code still in its transition period. This does not archive the portal, and you can make a new code afterwards."
      cancelLabel="Cancel"
      confirmLabel="Stop all codes"
      pendingLabel="Stopping…"
      confirmDisabled={!reason.trim()}
      onConfirm={() => form.handleSubmit()}
    >
      <form.Field name="reason">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <FormFieldFrame
              id="portal-revoke-reason"
              label="Reason"
              invalid={invalid}
              errors={invalid ? field.state.meta.errors : undefined}
            >
              <Input
                id="portal-revoke-reason"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={invalid}
                placeholder="Printed code was misplaced"
                maxLength={500}
                disabled={mutation.isPending}
                autoFocus
              />
            </FormFieldFrame>
          )
        }}
      </form.Field>
    </ConfirmationDialog>
  )
}
