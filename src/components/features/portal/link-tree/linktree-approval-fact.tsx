// The approval of the place a tile opens, in place under its address: who
// approved it, or why guests cannot see the tile yet. A tile whose address was
// never checked (one from before approvals) can be checked from here.

import { TriangleAlert, ShieldCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { PortalLinktreeDestination } from '#/contexts/portal/application/public-api'
import { describeLinkApproval } from './linktree-rules'

type Props = Readonly<{
  destination: PortalLinktreeDestination
  memberNames: ReadonlyMap<string, string>
  onCheck: () => void
  isChecking: boolean
  disabled: boolean
}>

export function LinktreeApprovalFact({
  destination,
  memberNames,
  onCheck,
  isChecking,
  disabled,
}: Props) {
  const fact = describeLinkApproval(destination, memberNames)
  const Icon = fact.tone === 'ok' ? ShieldCheck : TriangleAlert
  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${fact.tone === 'ok' ? 'text-muted-foreground' : 'text-warn'}`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{fact.text}</span>
      {destination.state === 'unclassified' ? (
        <Button
          type="button"
          variant="link"
          size="inline"
          disabled={disabled || isChecking}
          onClick={onCheck}
        >
          Check this address
        </Button>
      ) : null}
    </p>
  )
}
