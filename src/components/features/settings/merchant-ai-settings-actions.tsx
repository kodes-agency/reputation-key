import { FormActions } from '#/components/forms/form-actions'
import { Button } from '#/components/ui/button'
import { CardFooter } from '#/components/ui/card'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

export function MerchantAiSettingsActions({
  propertyName,
  enableCallToAction,
  canRevoke,
  isEnabled,
  canEnable,
  canSave,
  selectionChanged,
  pending,
  onEnable,
  onChange,
  onRevoke,
  onResetSelection,
}: Readonly<{
  propertyName: string
  /** The notice's call to action, rendered for this property. */
  enableCallToAction: string
  canRevoke: boolean
  isEnabled: boolean
  canEnable: boolean
  canSave: boolean
  /** The capability choice differs from the one saved: Reset shows. */
  selectionChanged: boolean
  pending: boolean
  /** Enable and turn off are confirmed: a refusal rejects and the dialog says it. */
  onEnable: () => Promise<unknown>
  onChange: () => void
  onRevoke: () => Promise<unknown>
  /** Puts the saved capability choice back. */
  onResetSelection: () => void
}>) {
  return (
    <CardFooter className="border-t">
      {canRevoke ? (
        <FormActions
          dirty={isEnabled && selectionChanged}
          onReset={onResetSelection}
          pending={pending}
          leading={
            <ConfirmationDialog
              trigger={
                <ConfirmationTrigger tone="neutral" disabled={pending}>
                  Turn off AI features
                </ConfirmationTrigger>
              }
              // Reversible: Enable AI features turns it back on, so the tone is neutral.
              tone="neutral"
              title={`Turn off AI features for ${propertyName}?`}
              description="Future review analysis, reply drafting, and property trend processing will stop for this property. This does not disconnect Google."
              cancelLabel="Keep AI features on"
              confirmLabel="Turn off"
              pendingLabel="Turning off…"
              onConfirm={onRevoke}
            />
          }
        >
          {isEnabled ? (
            <Button pending={pending} disabled={!canSave} onClick={onChange}>
              Save feature access
            </Button>
          ) : null}
        </FormActions>
      ) : (
        <FormActions>
          <ConfirmationDialog
            trigger={<Button disabled={!canEnable}>Enable AI features</Button>}
            title={`${enableCallToAction}?`}
            description="You confirm the data-handling notice above and authorize review analysis, editable reply drafting, and de-identified property trends for this property."
            cancelLabel="Cancel"
            confirmLabel="Confirm & enable"
            pendingLabel="Enabling…"
            confirmDisabled={!canEnable}
            onConfirm={onEnable}
          />
        </FormActions>
      )}
    </CardFooter>
  )
}
