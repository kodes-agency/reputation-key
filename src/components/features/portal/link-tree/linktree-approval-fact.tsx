// The approval of the place a tile opens, in place under its address: who
// approved it, or why guests cannot see the tile yet. A tile whose address was
// never checked (one from before approvals) can be checked from here, and an
// account admin can approve a waiting address or turn an address off without
// leaving the tile. While an address is being checked the line says so
// (`LinktreeCheckingLine`), instead of showing the previous address's state.

import { useState } from 'react'
import { LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PortalLinktreeDestination } from '#/contexts/portal/application/public-api'
import { DestinationTurnOff } from '../portal-settings/destination-turn-off'
import type { LinkSiteControls } from './link-approval-controls'
import { describeLinkApproval } from './linktree-approval-rules'

type Props = Readonly<{
  destination: PortalLinktreeDestination
  memberNames: ReadonlyMap<string, string>
  /** Checks the saved address again; resolves when the check is over. */
  onCheck: () => Promise<unknown>
  disabled: boolean
  /** Approve and turn-off for an account admin; absent for everyone else. */
  site?: LinkSiteControls
}>

/** Shown in place of the approval line while the server checks an address. */
export function LinktreeCheckingLine() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
      />
      Checking address…
    </p>
  )
}

export function LinktreeApprovalFact({
  destination,
  memberNames,
  onCheck,
  disabled,
  site,
}: Props) {
  const [isChecking, setIsChecking] = useState(false)
  if (isChecking) return <LinktreeCheckingLine />
  const fact = describeLinkApproval(destination, memberNames, {
    canApprove: site !== undefined,
  })
  const Icon = fact.tone === 'ok' ? ShieldCheck : TriangleAlert
  const check = () => {
    setIsChecking(true)
    void onCheck()
      .catch(() => undefined)
      .finally(() => setIsChecking(false))
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p
        className={`flex min-w-0 items-center gap-2 text-sm ${fact.tone === 'ok' ? 'text-muted-foreground' : 'text-warn'}`}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span>{fact.text}</span>
      </p>
      {destination.state === 'unclassified' ? (
        <Button
          type="button"
          variant="link"
          size="inline"
          touch
          disabled={disabled}
          onClick={check}
        >
          Check this address
        </Button>
      ) : null}
      <SiteActions destination={destination} site={site} />
    </div>
  )
}

function SiteActions({
  destination,
  site,
}: Readonly<{ destination: PortalLinktreeDestination; site?: LinkSiteControls }>) {
  if (site === undefined) return null
  const isWaiting = destination.state === 'pending'
  const isOn = isWaiting || destination.state === 'approved'
  return (
    <>
      {isWaiting ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={site.isBusy}
          onClick={() => void site.approve().catch(() => undefined)}
        >
          Approve
        </Button>
      ) : null}
      {isOn ? (
        <DestinationTurnOff
          hostname={site.hostname}
          disabled={site.isBusy}
          onConfirm={site.turnOff}
        />
      ) : null}
    </>
  )
}
