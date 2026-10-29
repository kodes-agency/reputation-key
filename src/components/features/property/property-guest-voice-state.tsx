import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { AiPropertyInsightsRead } from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { usePermissions } from '#/shared/hooks/usePermissions'

type ReadyInsights = Extract<AiPropertyInsightsRead, { status: 'ready' }>

// What Guest voice says in place of its topics when there are none to show: AI
// analysis off, still being prepared, or no reviews in the range.

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
  range,
  propertyId,
}: Readonly<{
  result: Exclude<AiPropertyInsightsRead, ReadyInsights>
  range: GuestVoiceRange
  propertyId: string
}>) {
  if (result.status === 'disabled') return <DisabledGuestVoice propertyId={propertyId} />
  if (result.status === 'preparing') {
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
  // Automatic reaches back 12 months, the furthest a window goes short of All
  // time, so a longer range is not the way out of it.
  if (range === 'auto') {
    return (
      <Alert variant="info">
        <AlertTitle>No reviews in the last 12 months</AlertTitle>
        <AlertDescription>
          Guest voice appears once this property has reviews to read. Choose All time to
          look further back.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="info">
      <AlertTitle>
        {range === 'all'
          ? 'Not enough review evidence in the available history'
          : 'Not enough review evidence in this period'}
      </AlertTitle>
      <AlertDescription>
        {range === 'all'
          ? 'No reviews were found within the available AI analysis history.'
          : 'No reviews were found in the selected period. Choose a longer range to look further back.'}
      </AlertDescription>
    </Alert>
  )
}
