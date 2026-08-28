import { useForm } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { AlertDialogCancel, AlertDialogFooter } from '#/components/ui/alert-dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { plannedPortalTokenReplacementFormSchema } from '#/contexts/portal/application/dto/portal-token-lifecycle.dto'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

export function PortalPlannedReplacementForm({
  portalId,
  mutation,
  onStarted,
  onLinkIssued,
}: Readonly<{
  portalId: string
  mutation: PortalShareMutations['rotateMutation']
  onStarted: () => void
  onLinkIssued: (link: IssuedPortalLink) => void
}>) {
  const form = useForm({
    defaultValues: { gracePeriodDays: 30 },
    validators: { onSubmit: plannedPortalTokenReplacementFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = plannedPortalTokenReplacementFormSchema.parse(value)
      onStarted()
      const link = await mutation({
        data: {
          portalId,
          replacementKind: 'planned',
          gracePeriodDays: parsed.gracePeriodDays,
        },
      })
      onLinkIssued(link)
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
      <form.Field name="gracePeriodDays">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field className="py-2" data-invalid={invalid}>
              <FieldLabel htmlFor="portal-replacement-days">
                Transition period (days)
              </FieldLabel>
              <Input
                id="portal-replacement-days"
                name={field.name}
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                step={1}
                value={Number.isNaN(field.state.value) ? '' : field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.valueAsNumber)
                }
                aria-invalid={invalid}
                disabled={mutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                30 days is recommended. You can choose between 1 and 90 days.
              </p>
              {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
            </Field>
          )
        }}
      </form.Field>
      <AlertDialogFooter>
        <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create replacement'}
        </Button>
      </AlertDialogFooter>
    </form>
  )
}
