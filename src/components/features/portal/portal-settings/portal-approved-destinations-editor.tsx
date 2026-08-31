import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { PortalApprovedDestinationRequestForm } from './portal-approved-destination-request-form'
import { PortalExperienceActionError } from './portal-experience-action-error'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
} from './portal-experience-settings-types'

export function PortalApprovedDestinationsEditor({
  portalId,
  state,
  actions,
  disabled,
}: Readonly<{
  portalId: string
  state: PortalApprovedDestinationList
  actions: PortalExperienceActions
  disabled: boolean
}>) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <h4 className="font-medium">Approved link destinations</h4>
        <p className="text-sm text-muted-foreground">
          Recognized services are approved automatically. Other sites wait for an Account
          Admin before they can appear on a published Portal.
        </p>
      </div>
      <PortalApprovedDestinationRequestForm
        portalId={portalId}
        action={actions.requestDestination}
        disabled={disabled}
      />
      {state.destinations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No secondary destinations yet.</p>
      ) : (
        <ul className="divide-y rounded-md border px-3">
          {state.destinations.map((destination) => (
            <li
              key={destination.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{destination.hostname}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {destination.normalizedUri}
                </p>
              </div>
              <DestinationActions
                portalId={portalId}
                destination={destination}
                actions={actions}
                disabled={disabled}
                canApprove={state.canApprove}
              />
            </li>
          ))}
        </ul>
      )}
      <PortalExperienceActionError action={actions.requestDestination} />
      <PortalExperienceActionError action={actions.approveDestination} />
      <PortalExperienceActionError action={actions.disableDestination} />
    </div>
  )
}

function DestinationActions({
  portalId,
  destination,
  actions,
  disabled,
  canApprove,
}: Readonly<{
  portalId: string
  destination: PortalApprovedDestinationList['destinations'][number]
  actions: PortalExperienceActions
  disabled: boolean
  canApprove: boolean
}>) {
  const active =
    destination.approvalState === 'approved' || destination.approvalState === 'pending'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={destination.approvalState === 'approved' ? 'secondary' : 'outline'}>
        {destination.approvalState === 'pending'
          ? 'Waiting for approval'
          : destination.approvalState}
      </Badge>
      {canApprove && destination.approvalState === 'pending' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || actions.approveDestination.isPending}
          onClick={() => {
            void actions
              .approveDestination({ data: { portalId, destinationId: destination.id } })
              .catch(() => undefined)
          }}
        >
          Approve
        </Button>
      ) : null}
      {canApprove && active ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || actions.disableDestination.isPending}
          onClick={() => {
            void actions
              .disableDestination({
                data: {
                  portalId,
                  destinationId: destination.id,
                  reason: 'Disabled by an Account Admin',
                },
              })
              .catch(() => undefined)
          }}
        >
          Disable
        </Button>
      ) : null}
    </div>
  )
}
