// Turning off a site allowed for links, from the tile that opens it or from the
// list of sites. A site that is turned off cannot be approved again (only a
// waiting one can), so it asks first and names the site.

import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'

/** Stored with the site when it is turned off. */
export const TURN_OFF_REASON = 'Turned off by an account admin'

export function DestinationTurnOff({
  hostname,
  disabled,
  onConfirm,
}: Readonly<{
  hostname: string
  disabled: boolean
  onConfirm: () => Promise<unknown>
}>) {
  return (
    <ConfirmationDialog
      trigger={
        <ConfirmationTrigger tone="destructive" size="sm" disabled={disabled}>
          Turn off
        </ConfirmationTrigger>
      }
      title={`Turn off ${hostname}?`}
      description="Links to it stop showing to guests on every portal at this property, and it cannot be approved again."
      cancelLabel="Keep it on"
      confirmLabel="Turn off site"
      pendingLabel="Turning off…"
      tone="destructive"
      onConfirm={onConfirm}
    />
  )
}
