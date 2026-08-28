import { useForm } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { AlertDialogCancel, AlertDialogFooter } from '#/components/ui/alert-dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { revokePortalTokensInputSchema } from '#/contexts/portal/application/dto/portal-token-lifecycle.dto'
import type { PortalShareMutations } from './portal-share-types'

const revokeLinksFormSchema = revokePortalTokensInputSchema
  .pick({ reason: true })
  .required()

export function PortalRevokeLinksForm({
  portalId,
  mutation,
  onStarted,
  onRevoked,
}: Readonly<{
  portalId: string
  mutation: PortalShareMutations['revokeMutation']
  onStarted: () => void
  onRevoked: () => void
}>) {
  const form = useForm({
    defaultValues: { reason: '' },
    validators: { onSubmit: revokeLinksFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = revokeLinksFormSchema.parse(value)
      onStarted()
      await mutation({ data: { portalId, reason: parsed.reason } })
      form.reset()
      onRevoked()
    },
  })
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <form.Field name="reason">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor="portal-revoke-reason">Reason</FieldLabel>
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
              {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
            </Field>
          )
        }}
      </form.Field>
      <AlertDialogFooter>
        <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
        <form.Subscribe selector={(state) => state.values.reason}>
          {(reason) => (
            <Button
              type="submit"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!reason.trim() || mutation.isPending}
            >
              {mutation.isPending ? 'Revoking…' : 'Revoke links'}
            </Button>
          )}
        </form.Subscribe>
      </AlertDialogFooter>
    </form>
  )
}
