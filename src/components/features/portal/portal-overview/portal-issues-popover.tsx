// "2 issues": the one place a Portal's problems are spelled out when there is
// more than one. A single issue is named in the row and is a link to its fix
// (`PortalIssueLink`); two or more are counted in the row, and this says what each
// is and where to put it right.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { EXPLAIN_UNDERLINE } from '#/components/ui/explain-trigger'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import { issuesTone, type PortalIssue, type PortalIssueFix } from './portal-attention'
import { PORTAL_LINE_LINK, PORTAL_LINE_TONE } from './portal-line-link'

type Ids = Readonly<{ portalId: string; propertyId: string }>

type Props = Ids &
  Readonly<{
    portalName: string
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

/**
 * The link to where an issue is put right: Share, the responsible managers, the
 * property's Google settings or the portal itself. It writes its own words when
 * it is the row's line (`children`), and its own class when it is not a popover's.
 */
export function FixLink({
  fix,
  portalId,
  propertyId,
  className = LINK,
  ariaLabel,
  children,
}: Ids &
  Readonly<{
    fix: PortalIssueFix
    className?: string
    /** When the words on screen are not a name: the line says what is wrong, the name says where it leads. */
    ariaLabel?: string
    children?: ReactNode
  }>) {
  const label = children ?? FIX_LABEL[fix]
  if (fix === 'google') {
    return (
      <Link
        to="/properties/$propertyId/settings/google"
        params={{ propertyId }}
        className={className}
        aria-label={ariaLabel}
      >
        {label}
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
      params={{ propertyId, portalId }}
      search={search}
      className={className}
      aria-label={ariaLabel}
    >
      {label}
    </Link>
  )
}

export function fixLabel(fix: PortalIssueFix): string {
  return FIX_LABEL[fix]
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
        <Button
          type="button"
          variant="link"
          size="inline"
          touch
          aria-label={`${portalName}: ${label}`}
          className={cn(
            PORTAL_LINE_LINK,
            PORTAL_LINE_TONE[issuesTone(issues)],
            EXPLAIN_UNDERLINE,
            'hover:decoration-solid',
          )}
        >
          {children}
        </Button>
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
