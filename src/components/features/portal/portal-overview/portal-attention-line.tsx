// The one line under a Portal's name, or nothing: status is shown only by
// exception (round-4 owner decision). A live Portal that needs nothing has no
// line. Where the line says something is wrong or waiting, it is also the way to
// put it right: a single issue is a link to its fix, two or more open a popover
// that says which, "Continue setup" and "Review & publish" are links, and so is
// an older code (the code is replaced on Share).
//
// Every control in the line is a tap target on a phone (`portal-line-link`).
import { Link } from '@tanstack/react-router'
import { CircleDashed, History, PencilLine, TriangleAlert } from 'lucide-react'
import { cn } from '#/lib/utils'
import {
  attentionLine,
  issuesTone,
  type PortalAttention,
  type PortalIssue,
} from './portal-attention'
import { FixLink, fixLabel, PortalIssuesPopover } from './portal-issues-popover'
import { PORTAL_LINE_TONE, portalLineLinkClass } from './portal-line-link'
import type { PortalOverviewItem } from './portal-overview-view'
import { usePortalAccess } from './use-portal-access'

type LineProps = Readonly<{
  item: PortalOverviewItem
  propertyId: string
  line: string
}>

const LINE = 'flex items-center gap-1.5 text-xs text-muted-foreground'

function IssuesLine({
  item,
  propertyId,
  line,
  issues,
}: LineProps & Readonly<{ issues: readonly PortalIssue[] }>) {
  const { row } = item
  const icon = <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
  const [only] = issues
  // One issue is named, and is the link to where it is put right.
  if (only !== undefined && issues.length === 1) {
    return (
      <FixLink
        fix={only.fix}
        portalId={row.portalId}
        propertyId={propertyId}
        ariaLabel={`${row.name}: ${only.short}. ${fixLabel(only.fix)}`}
        className={portalLineLinkClass(
          cn(PORTAL_LINE_TONE[issuesTone(issues)], 'w-fit underline'),
        )}
      >
        {icon}
        {line}
      </FixLink>
    )
  }
  return (
    <PortalIssuesPopover
      portalName={row.name}
      portalId={row.portalId}
      propertyId={propertyId}
      issues={issues}
      label={line}
    >
      {icon}
      {line}
    </PortalIssuesPopover>
  )
}

function DraftLine({ item, propertyId, line }: LineProps) {
  const { row } = item
  return (
    <p className={LINE}>
      <CircleDashed className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {line} ·{' '}
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId: row.portalId }}
          search={{ tab: 'page' }}
          aria-label={`Continue setup for ${row.name}`}
          className={portalLineLinkClass('whitespace-nowrap')}
        >
          Continue setup
        </Link>
      </span>
    </p>
  )
}

function OlderCodeLine({ item, propertyId, line }: LineProps) {
  return (
    <p className={LINE}>
      <History className="size-3.5 shrink-0" aria-hidden="true" />
      <FixLink
        fix="share"
        portalId={item.row.portalId}
        propertyId={propertyId}
        ariaLabel={`${line}: open Share for ${item.row.name}`}
        className={portalLineLinkClass('font-normal')}
      >
        {line}
      </FixLink>
    </p>
  )
}

/** "2 changes not live · Review & publish": the second part only for who may publish. */
function PendingLine({ item, propertyId, line }: LineProps) {
  const { canEdit } = usePortalAccess()
  const { row } = item
  return (
    <p className={LINE}>
      <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {line}
        {canEdit ? (
          <>
            {' '}
            ·{' '}
            <Link
              to="/properties/$propertyId/portals/$portalId/review"
              params={{ propertyId, portalId: row.portalId }}
              search={{ tab: 'page' }}
              aria-label={`Review and publish ${row.name}`}
              className={portalLineLinkClass('whitespace-nowrap')}
            >
              Review &amp; publish
            </Link>
          </>
        ) : null}
      </span>
    </p>
  )
}

function lineOf(attention: PortalAttention, props: LineProps) {
  switch (attention.kind) {
    case 'issues':
      return <IssuesLine {...props} issues={attention.issues} />
    case 'draft':
      return <DraftLine {...props} />
    case 'older_code':
      return <OlderCodeLine {...props} />
    case 'pending':
      return <PendingLine {...props} />
    default:
      return <p className="text-xs text-muted-foreground">{props.line}</p>
  }
}

export function PortalAttentionLine({
  item,
  propertyId,
}: Readonly<{ item: PortalOverviewItem; propertyId: string }>) {
  const line = attentionLine(item.attention)
  if (line === null) return null
  return lineOf(item.attention, { item, propertyId, line })
}
