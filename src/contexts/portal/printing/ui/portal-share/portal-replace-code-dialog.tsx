// "Replace the code?": how the current code ends, then a new code is made. A
// planned replacement keeps the old code working for a transition period; a
// security replacement stops it now and so confirms in the destructive tone. The
// choice is the dialog's body, and the dialog stays open while the new code is
// made, closing on the address that is shown right after.
import { useForm, useStore } from '@tanstack/react-form'
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { RadioGroup } from '#/components/ui/radio-group'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import {
  portalCodeReplacementFormSchema,
  toRotatePortalTokenInput,
  type PortalCodeReplacementForm,
} from '#/contexts/portal/application/dto/portal-token-lifecycle.dto'
import { PortalReplacementChoice } from './portal-replacement-choice'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

const DEFAULT_TRANSITION_DAYS = 30
const TRANSITION_HELP = '30 days is recommended. You can choose between 1 and 90 days.'

type Kind = PortalCodeReplacementForm['replacementKind']

export function PortalReplaceCodeDialog({
  open,
  onOpenChange,
  portalId,
  mutation,
  onLinkIssued,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  mutation: PortalShareMutations['rotateMutation']
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
      onLinkIssued(await mutation({ data: toRotatePortalTokenInput(portalId, parsed) }))
    },
  })
  const values = useStore(form.store, (state) => state.values)
  const checked = portalCodeReplacementFormSchema.safeParse(values)
  const security = values.replacementKind === 'security'

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      // Back to a planned replacement once it has gone, not while it fades.
      onCloseAutoFocus={() => form.reset()}
      // A security replacement breaks every printed and programmed code at once,
      // so its button says so instead of sharing the neutral label of a swap.
      tone={security ? 'destructive' : 'neutral'}
      title="Replace the code?"
      description="A new code is made. Its QR image and addresses are shown right after, and only then, so have somewhere to save them."
      cancelLabel="Cancel"
      confirmLabel={security ? 'Replace now and stop the old code' : 'Replace code'}
      pendingLabel="Replacing…"
      confirmDisabled={!checked.success}
      onConfirm={() => form.handleSubmit()}
    >
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
      {security ? null : (
        <form.Field name="gracePeriodDays">
          {(field) => {
            const invalid = field.state.meta.isTouched && !checked.success
            return (
              <FormFieldFrame
                id="portal-replacement-days"
                label="Transition period (days)"
                description={TRANSITION_HELP}
                invalid={invalid}
                errors={
                  invalid
                    ? checked.error?.issues.map(({ message }) => ({ message }))
                    : undefined
                }
                className="py-2"
              >
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
                  aria-describedby={describedByOf(
                    'portal-replacement-days',
                    TRANSITION_HELP,
                    invalid,
                  )}
                  disabled={mutation.isPending}
                />
              </FormFieldFrame>
            )
          }}
        </form.Field>
      )}
    </ConfirmationDialog>
  )
}
