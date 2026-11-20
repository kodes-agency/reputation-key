// Sites allowed for links: the places a tile may open. A tile is where an
// address is entered and, for an account admin, approved or turned off in place;
// this list is the account admin's overview of every site at the property, so it
// sits behind a disclosure that opens by itself while a site waits for an answer.
// A manager enters addresses on the tiles and has no list here.

import { ChevronRight } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { StatusBadge } from '#/components/ui/status-badge'
import { DestinationTurnOff, TURN_OFF_REASON } from './destination-turn-off'
import {
  APPROVED_DESTINATION_STATUS,
  HELD_BACK_EXPLANATION,
  describeWaitingSites,
} from './portal-approved-destination-status'
import { PortalApprovedDestinationRequestForm } from './portal-approved-destination-request-form'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
} from './portal-experience-settings-types'

type Destination = PortalApprovedDestinationList['destinations'][number]

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
  if (!state.canApprove) return null
  const hasWaiting = state.destinations.some((site) => site.approvalState === 'pending')
  return (
    <Collapsible defaultOpen={hasWaiting} className="rounded-md border">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 rounded-md px-4 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        />
        <span className="font-medium">Sites allowed for links</span>
        <span
          className={`text-sm ${hasWaiting ? 'font-medium text-warn' : 'text-muted-foreground'}`}
        >
          · {describeWaitingSites(state.destinations)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t p-4">
        <p className="text-sm text-muted-foreground">
          Guests can follow a link only to a site on this list. Recognised services are
          approved automatically; any other site waits here for an account admin.
        </p>
        <PortalApprovedDestinationRequestForm
          portalId={portalId}
          action={actions.requestDestination}
          disabled={disabled}
        />
        {state.destinations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other sites added yet.</p>
        ) : (
          <ul className="divide-y rounded-md border px-3">
            {state.destinations.map((destination) => (
              <li key={destination.id} className="space-y-1 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                  />
                </div>
                {destination.approvalState === 'quarantined' ? (
                  <p className="text-xs text-muted-foreground">{HELD_BACK_EXPLANATION}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function DestinationActions({
  portalId,
  destination,
  actions,
  disabled,
}: Readonly<{
  portalId: string
  destination: Destination
  actions: PortalExperienceActions
  disabled: boolean
}>) {
  const active =
    destination.approvalState === 'approved' || destination.approvalState === 'pending'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={destination.approvalState} map={APPROVED_DESTINATION_STATUS} />
      {destination.approvalState === 'pending' ? (
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
      {active ? (
        // A site that is turned off cannot be approved again (only a waiting
        // one can), so it asks first.
        <DestinationTurnOff
          hostname={destination.hostname}
          disabled={disabled || actions.disableDestination.isPending}
          onConfirm={() =>
            actions.disableDestination({
              data: { portalId, destinationId: destination.id, reason: TURN_OFF_REASON },
            })
          }
        />
      ) : null}
    </div>
  )
}
