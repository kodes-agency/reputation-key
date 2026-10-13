import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { StatusBadge } from '#/components/ui/status-badge'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  GOOGLE_BINDING_STATUS,
  type GoogleBindingState,
} from '../property-lifecycle-model'
import {
  googleReviewDestinationText,
  type GoogleReviewDestinationSubject,
} from './property-google-destination'

type Props = Readonly<{
  property: GoogleReviewDestinationSubject & Readonly<{ id: string }>
}>

/** What each state of the link means for this property; the pill is `GOOGLE_BINDING_STATUS`. */
const BINDING_DETAIL: Readonly<Record<GoogleBindingState, string>> = {
  active: 'Reviews sync from this Business Profile and replies can be published to it.',
  account_confirmation_required:
    'Google needs the Business Profile account confirmed before reviews sync again.',
  disconnected: 'Reviews no longer sync. Relink the Business Profile to resume.',
  unbound: 'No Business Profile is linked to this property yet.',
}

/**
 * Where this property's reviews come from. Linking is done through the import
 * flow and the Organization's Google connection; disconnecting is destructive,
 * so it lives in the Danger zone with the other lifecycle actions.
 */
export function PropertyGoogleSection({ property }: Props) {
  const { can } = usePermissions()
  const isLinked = property.googleBindingState === 'active'

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Google Business Profile</CardTitle>
        <CardDescription>{BINDING_DETAIL[property.googleBindingState]}</CardDescription>
        <CardAction>
          <StatusBadge status={property.googleBindingState} map={GOOGLE_BINDING_STATUS} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DescriptionList termWidth="wide" aria-label="Google review destination">
          <DescriptionItem term="Review destination">
            {googleReviewDestinationText(property)}
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t">
        {can('property.import_gbp_v2') ? (
          <Button asChild variant={isLinked ? 'outline' : 'default'} size="sm">
            <Link to="/properties/import-google">
              {isLinked ? 'Relink with Google import' : 'Link with Google import'}
            </Link>
          </Button>
        ) : null}
        {can('integration.manage') ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/integrations">
              Open Google integrations
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
        {isLinked ? (
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
