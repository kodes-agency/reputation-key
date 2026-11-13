import { StatusBadge } from '#/components/ui/status-badge'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  presentGoogleReviewDestination,
  type GoogleReviewDestinationStatus,
} from './google-review-destination-status'
import { TouchInlineLink } from '#/components/ui/inline-touch-link'

export function GoogleReviewDestinationCard({
  destination,
}: Readonly<{ destination: GoogleReviewDestinationStatus }>) {
  const presentation = presentGoogleReviewDestination(destination)
  const { can } = usePermissions()
  const canManageGoogleConnection = can('integration.manage')
  const canConfirmGoogleProperty = can('property.import_gbp_v2')

  return (
    <div
      className="rounded-md border px-4 py-3"
      aria-labelledby="google-destination-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="google-destination-title" className="text-sm font-medium">
          Google review destination
        </h3>
        <StatusBadge tone={presentation.tone} label={presentation.label} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {presentation.description} No separate link needs to be entered for this portal.
      </p>
      {destination.state === 'unavailable' ? (
        <div className="mt-2 flex flex-col items-start gap-1">
          {canManageGoogleConnection ? (
            <TouchInlineLink to="/settings/integrations" className="text-xs">
              Open Google integrations
            </TouchInlineLink>
          ) : null}
          {canConfirmGoogleProperty ? (
            <TouchInlineLink to="/properties/import-google" className="text-xs">
              Review property import
            </TouchInlineLink>
          ) : null}
          {!canManageGoogleConnection || !canConfirmGoogleProperty ? (
            <p className="text-xs text-muted-foreground">
              Ask an account admin to connect or refresh Google for this property.
            </p>
          ) : null}
        </div>
      ) : null}
      {presentation.confirmedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last confirmed {presentation.confirmedAt}
        </p>
      )}
    </div>
  )
}
