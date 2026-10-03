// "2 issues": the one place a Portal's problems are spelled out. A line in the
// list says how many; this says what each is and where to put it right.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import type { PortalIssue, PortalIssueFix } from './portal-attention'

type Props = Readonly<{
  portalName: string
  portalId: string
  propertyId: string
  issues: readonly PortalIssue[]
  /** The count the trigger shows ("2 issues"); its name also says whose. */
  label: string
  /** The trigger's face: an icon and the count. */
  children: ReactNode
}>

const FIX_LABEL: Readonly<Record<PortalIssueFix, string>> = {
  share: 'Open Share',
  responsible: 'Choose a manager',
  google: 'Check Google',
  page: 'Open the portal',
}

const LINK = 'text-xs font-medium text-foreground underline underline-offset-4'

function FixLink({
  fix,
  portalId,
  propertyId,
}: Readonly<{ fix: PortalIssueFix; portalId: string; propertyId: string }>) {
  const params = { propertyId, portalId }
  if (fix === 'google') {
    return (
      <Link
        to="/properties/$propertyId/settings/google"
        params={{ propertyId }}
        className={LINK}
      >
        {FIX_LABEL.google}
      </Link>
    )
  }
  const search =
    fix === 'share'
      ? ({ tab: 'share' } as const)
      : fix === 'responsible'
        ? ({ tab: 'page', section: 'responsible' } as const)
        : ({ tab: 'page' } as const)
  return (
    <Link
      to="/properties/$propertyId/portals/$portalId"
      params={params}
      search={search}
      className={LINK}
    >
      {FIX_LABEL[fix]}
    </Link>
  )
}

export function PortalIssuesPopover({
  portalName,
  portalId,
  propertyId,
  issues,
  label,
  children,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${portalName}: ${label}`}
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-sm text-xs font-medium text-warn',
            'underline decoration-dotted underline-offset-4 hover:decoration-solid',
            'focus-ring',
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        aria-label={`Issues with ${portalName}`}
      >
        <ul className="flex flex-col gap-3">
          {issues.map((issue) => (
            <li key={issue.code} className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">{issue.title}</p>
              <p className="text-xs text-muted-foreground">{issue.detail}</p>
              <FixLink fix={issue.fix} portalId={portalId} propertyId={propertyId} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
