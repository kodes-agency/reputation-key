import { useForm } from '@tanstack/react-form'
import { submitHandler } from '#/components/forms/form-submit'
import { Button } from '#/components/ui/button'
import { AlertDialogCancel, AlertDialogFooter } from '#/components/ui/alert-dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { RadioGroup } from '#/components/ui/radio-group'
import {
  portalCodeReplacementFormSchema,
  toRotatePortalTokenInput,
  type PortalCodeReplacementForm,
} from '#/contexts/portal/application/dto/portal-token-lifecycle.dto'
import { PortalReplacementChoice } from './portal-replacement-choice'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

const DEFAULT_TRANSITION_DAYS = 30

type Kind = PortalCodeReplacementForm['replacementKind']

// A security replacement breaks every printed and programmed code at once, so its
// button says so instead of sharing the neutral label of a planned swap.
function submitLabel(kind: Kind, isPending: boolean): string {
  if (isPending) return 'Replacing…'
  return kind === 'security' ? 'Replace now and stop the old code' : 'Replace code'
}

export function PortalReplaceCodeForm({
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
    defaultValues: {
      replacementKind: 'planned' as Kind,
      gracePeriodDays: DEFAULT_TRANSITION_DAYS,
    },
    validators: { onSubmit: portalCodeReplacementFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = portalCodeReplacementFormSchema.parse(value)
      onStarted()
      const link = await mutation({ data: toRotatePortalTokenInput(portalId, parsed) })
      onLinkIssued(link)
    },
  })
  return (
    <form className="grid gap-4" onSubmit={submitHandler(form)}>
      <form.Field name="replacementKind">
        {(field) => (
          <RadioGroup
            aria-label="How the current code ends"
            value={field.state.value}
            onValueChange={(next) => field.handleChange(next as Kind)}
            disabled={mutation.isPending}
          >
            <PortalReplacementChoice
              value="planned"
              title="Planned"
              description="The current code keeps working for a transition period, so printed and programmed codes can be swapped without a gap."
            />
            <PortalReplacementChoice
              value="security"
              title="At once, for security"
              description="The current code stops working now. Use this when a printed code was lost or shared by mistake."
            />
          </RadioGroup>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.replacementKind}>
        {(kind) =>
          kind === 'planned' && (
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
          )
        }
      </form.Subscribe>
      <AlertDialogFooter>
        <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
        <form.Subscribe selector={(state) => state.values.replacementKind}>
          {(kind) => (
            <Button
              type="submit"
              variant={kind === 'security' ? 'destructive' : 'default'}
              disabled={mutation.isPending}
            >
              {submitLabel(kind, mutation.isPending)}
            </Button>
          )}
        </form.Subscribe>
      </AlertDialogFooter>
    </form>
  )
}
