import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'

function DisabledGuestVoice({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  return (
    <Alert variant="info">
      <AlertTitle>AI analysis is off for this property</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Guest voice needs AI analysis. Nothing is sent to the AI provider until it is
          enabled.
        </p>
        {can('ai.manage') ? (
          <Button asChild size="sm">
            <Link to="/properties/$propertyId/settings/ai" params={{ propertyId }}>
              Turn on AI analysis
            </Link>
          </Button>
        ) : (
          <p>An account admin can enable it from this property&rsquo;s AI settings.</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function GuestVoiceState({
  result,
  propertyId,
}: Readonly<{
  result: Readonly<{ status: 'disabled' | 'preparing' }>
  propertyId: string
}>) {
  if (result.status === 'disabled') return <DisabledGuestVoice propertyId={propertyId} />
  return (
    <Alert variant="info">
      <AlertTitle>Guest voice is being prepared</AlertTitle>
      <AlertDescription>
        AI analysis is still settling. Topics appear as soon as there is enough review
        evidence.
      </AlertDescription>
    </Alert>
  )
}
