import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useGuestVoice } from './guest-voice-context'

export function GuestVoiceOverflow({
  count,
  label,
}: Readonly<{ count: number; label: string }>) {
  const { propertyId, startLocalDate, endLocalDate } = useGuestVoice()
  const { can } = usePermissions()
  if (!count) return null
  return (
    <p className="py-2 text-sm text-muted-foreground">
      {count}{' '}
      {count === 1
        ? label.replace(/concerns$/u, 'concern').replace(/^things/u, 'thing')
        : label}{' '}
      {count === 1 ? 'is' : 'are'} beyond this list.
      {can('inbox.read') ? (
        <>
          {' '}
          <InlineLink
            to="/inbox"
            search={{ propertyId, since: startLocalDate, until: endLocalDate }}
          >
            Open this period’s reviews
          </InlineLink>
        </>
      ) : null}
    </p>
  )
}
