import { RegionError } from '#/components/ui/region-error'

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
      <div className="pb-5">
        <RegionError
          size="compact"
          message="Email availability for this property couldn’t be checked."
          description="The email controls stay off until it is known."
          onRetry={onRetry}
        />
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
