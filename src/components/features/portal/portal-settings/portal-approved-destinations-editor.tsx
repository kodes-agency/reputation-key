import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { StatusBadge } from '#/components/ui/status-badge'
import { APPROVED_DESTINATION_STATUS } from './portal-approved-destination-status'
import { PortalApprovedDestinationRequestForm } from './portal-approved-destination-request-form'
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
        <h3 className="font-medium">Approved link destinations</h3>
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
      <StatusBadge status={destination.approvalState} map={APPROVED_DESTINATION_STATUS} />
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
        // A disabled destination cannot be approved again (only a pending one
        // can), so this one asks first.
        <ConfirmationDialog
          trigger={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || actions.disableDestination.isPending}
            >
              Disable
            </Button>
          }
          title={`Disable ${destination.hostname}?`}
          description="It stops being an approved destination for Portal links, and a disabled destination can't be approved again."
          cancelLabel="Keep destination"
          confirmLabel="Disable destination"
          pendingLabel="Disabling…"
          pending={actions.disableDestination.isPending}
          tone="destructive"
          onConfirm={() => {
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
        />
      ) : null}
    </div>
  )
}
