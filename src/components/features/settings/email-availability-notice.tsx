import { Button } from '#/components/ui/button'

/**
 * What is known about the selected Property's `notification.send_email`
 * capability. Only `allowed` enables the email controls; the other three say
 * why they are off, and an in-flight or failed check is never reported as "not
 * enabled".
 */
export type EmailAvailability = 'checking' | 'allowed' | 'unavailable' | 'unknown'

export function EmailAvailabilityNotice({
  availability,
  onRetry,
}: Readonly<{ availability: EmailAvailability; onRetry: () => void }>) {
  if (availability === 'allowed') return null
  if (availability === 'checking') {
    return (
      <p role="status" className="pb-5 text-sm text-muted-foreground">
        Checking whether email is available for this property…
      </p>
    )
  }
  if (availability === 'unknown') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 pb-5 text-sm">
        <p className="text-muted-foreground">
          Couldn&apos;t check whether email is available for this property. The email
          controls stay off until it is known.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Check again
        </Button>
      </div>
    )
  }
  return (
    <p
      role="status"
      className="pb-5 text-sm text-muted-foreground"
      data-testid="email-unavailable-notice"
    >
      Email delivery is not enabled for this property, so the email controls below are
      unavailable. In-app notifications are unaffected.
    </p>
  )
}
