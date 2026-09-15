import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { usePermissions } from '#/shared/hooks/usePermissions'

type GoogleBindingState =
  'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'

type Props = Readonly<{
  property: Readonly<{
    id: string
    googleBindingState: GoogleBindingState
    googleReviewDestination?: Readonly<{
      state: 'verified' | 'awaiting_refresh' | 'unavailable' | string
      retrievedAt: Date | string | null
    }>
  }>
}>

const BINDING: Readonly<
  Record<
    GoogleBindingState,
    Readonly<{ label: string; tone: 'ok' | 'attention'; detail: string }>
  >
> = {
  active: {
    label: 'Linked',
    tone: 'ok',
    detail: 'Reviews sync from this Business Profile and replies can be published to it.',
  },
  account_confirmation_required: {
    label: 'Confirmation needed',
    tone: 'attention',
    detail:
      'Google needs the Business Profile account confirmed before reviews sync again.',
  },
  disconnected: {
    label: 'Disconnected',
    tone: 'attention',
    detail: 'Reviews no longer sync. Relink the Business Profile to resume.',
  },
  unbound: {
    label: 'Not linked',
    tone: 'attention',
    detail: 'No Business Profile is linked to this property yet.',
  },
}

function destinationText(
  destination: Props['property']['googleReviewDestination'],
): string {
  if (!destination) return 'Not checked yet'
  if (destination.state === 'verified')
    return 'Verified — guests can leave a Google review'
  if (destination.state === 'awaiting_refresh') return 'Refreshing from Google'
  return 'Unavailable — portals offer private feedback only'
}

/**
 * Where this property's reviews come from. Linking is done through the import
 * flow and the Organization's Google connection; disconnecting is destructive,
 * so it lives in the Danger zone with the other lifecycle actions.
 */
export function PropertyGoogleSection({ property }: Props) {
  const { can } = usePermissions()
  const binding = BINDING[property.googleBindingState]

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Google Business Profile</CardTitle>
        <CardDescription>{binding.detail}</CardDescription>
        <CardAction>
          <Badge variant={binding.tone === 'ok' ? 'secondary' : 'outline'}>
            {binding.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Review destination</dt>
          <dd>{destinationText(property.googleReviewDestination)}</dd>
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t">
        {can('property.import_gbp_v2') ? (
          <Button
            asChild
            variant={binding.tone === 'ok' ? 'outline' : 'default'}
            size="sm"
          >
            <Link to="/properties/import-google">
              {property.googleBindingState === 'active'
                ? 'Relink with Google import'
                : 'Link with Google import'}
            </Link>
          </Button>
        ) : null}
        {can('integration.manage') ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/integrations">
              Organization Google connection
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
        {property.googleBindingState === 'active' ? (
          <Button asChild variant="ghost" size="sm">
            <Link
              to="/properties/$propertyId/settings/danger"
              params={{ propertyId: property.id }}
            >
              Disconnect…
            </Link>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
