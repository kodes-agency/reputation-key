// "Take this photo down" in the photograph dialog: the answer to a photo that
// must not be shown at all (a rights complaint, a mistaken upload). Unlike
// "Remove photo" it also stops published pages from serving the file, so it asks
// first and says so. The server decides who may: the button is only drawn for
// an Account Admin with Portals writes on, and a refusal is shown in place.

import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'

const TAKEDOWN_FAILED = 'The photo could not be taken down. Try again.'

type Props = Readonly<{
  /** Takes the photograph down and clears it from the look. A refusal is thrown. */
  onTakeDown: () => Promise<unknown>
  /** Called once the photograph is down, so the dialog can close. */
  onDone: () => void
  /** Called while the request is on its way, so the dialog stays open. */
  onBusyChange: (isBusy: boolean) => void
  disabled?: boolean
}>

export function PhotoTakedown({ onTakeDown, onDone, onBusyChange, disabled }: Props) {
  const [isAsking, setIsAsking] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const takeDown = async () => {
    setIsPending(true)
    onBusyChange(true)
    setMessage(null)
    try {
      await onTakeDown()
      onDone()
    } catch {
      setMessage(TAKEDOWN_FAILED)
      setIsPending(false)
      onBusyChange(false)
    }
  }

  if (!isAsking) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setIsAsking(true)}
      >
        Take this photo down
      </Button>
    )
  }
  return (
    <div role="group" aria-label="Take this photo down" className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Guests stop seeing it everywhere, published pages included, and the file is
        deleted. This cannot be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          pending={isPending}
          pendingLabel="Taking down…"
          onClick={() => void takeDown()}
        >
          Take it down
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setIsAsking(false)}
        >
          Keep it
        </Button>
      </div>
      <FormErrorBanner error={message} />
    </div>
  )
}
