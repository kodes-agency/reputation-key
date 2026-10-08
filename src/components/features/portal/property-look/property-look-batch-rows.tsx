// The lists inside the batch "Review & publish" dialog: the live portals with
// what the batch can do with each (a ready one has a tick, which leaves it out
// when cleared), and, once the batch has run, what came of each.
import { Check, CircleAlert, Minus, TriangleAlert } from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import type { PublishPortalsChangesResult } from '#/contexts/portal/application/public-api'
import type { BatchRow } from './use-property-look-batch'
import {
  describeEntry,
  describeLeftOut,
  describeOutcome,
  describeUnanswered,
} from './property-look-batch-rules'
import type { AffectedPortalRow } from './property-look-rules'
import { InlineLink } from '#/components/ui/inline-link'

/** A Property may have fifty live portals: the list scrolls inside the dialog, so the buttons stay on screen. */
const LIST = 'max-h-[min(24rem,45dvh)] overflow-y-auto rounded-lg border'
const ROW = 'flex min-h-11 items-start gap-3 px-3 py-2'

function Names({
  row,
  detail,
  tone = 'quiet',
}: Readonly<{
  row: AffectedPortalRow
  detail: string
  tone?: 'ok' | 'quiet' | 'warn'
}>) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{row.name}</span>
      <span
        className={cn(
          'block text-xs',
          tone === 'warn' ? 'text-negative' : 'text-muted-foreground',
        )}
      >
        {detail}
      </span>
    </span>
  )
}

/** A link at the end of a row: as tall as the row (a tap target on a phone), the words at its end. */
const ROW_LINK = 'flex shrink-0 items-center self-stretch px-1 text-sm'

function ReviewRow({
  propertyId,
  item,
  isLeftOut,
  isLocked,
  onToggle,
}: Readonly<{
  propertyId: string
  item: BatchRow
  isLeftOut: boolean
  isLocked: boolean
  onToggle: (portalId: string) => void
}>) {
  const { row, entry } = item
  const detail = describeEntry(entry)
  const review = {
    to: '/properties/$propertyId/portals/$portalId/review',
    params: { propertyId, portalId: row.portalId },
  } as const
  if (entry.kind === 'ready') {
    const id = `look-batch-${row.portalId}`
    return (
      <li className="border-t first:border-t-0">
        <div className={cn(ROW, isLocked ? '' : 'hover:bg-muted/40')}>
          <Checkbox
            id={id}
            className="mt-0.5"
            checked={!isLeftOut}
            disabled={isLocked}
            onCheckedChange={() => onToggle(row.portalId)}
          />
          <label
            htmlFor={id}
            className={cn(
              'min-w-0 flex-1',
              isLocked ? 'cursor-default' : 'cursor-pointer',
            )}
          >
            <Names row={row} detail={isLeftOut ? describeLeftOut(entry) : detail} />
          </label>
          {/* In a new tab, so the dialog and what is ticked in it are still here when the changes have been read. */}
          <InlineLink
            {...review}
            target="_blank"
            rel="noreferrer"
            aria-label={`See the changes waiting on ${row.name}`}
            className={ROW_LINK}
          >
            See changes
          </InlineLink>
        </div>
      </li>
    )
  }
  const blocked = entry.kind === 'blocked'
  const Icon = blocked || entry.kind === 'unreadable' ? TriangleAlert : Minus
  return (
    <li className="border-t first:border-t-0">
      <div className={ROW}>
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            blocked ? 'text-negative' : 'text-muted-foreground',
          )}
          aria-hidden
        />
        <Names row={row} detail={detail} tone={blocked ? 'warn' : 'quiet'} />
        {blocked ? (
          <InlineLink
            {...review}
            aria-label={`Open ${row.name} to fix it`}
            className={ROW_LINK}
          >
            Open
          </InlineLink>
        ) : null}
      </div>
    </li>
  )
}

export function BatchReviewRows({
  propertyId,
  rows,
  leftOut,
  isLocked,
  onToggle,
}: Readonly<{
  propertyId: string
  rows: readonly BatchRow[]
  leftOut: ReadonlySet<string>
  /** A publish is in flight: what is ticked is what was sent, so it cannot change. */
  isLocked: boolean
  onToggle: (portalId: string) => void
}>) {
  return (
    <ul aria-label="Live portals" className={LIST}>
      {rows.map((item) => (
        <ReviewRow
          key={item.row.portalId}
          propertyId={propertyId}
          item={item}
          isLeftOut={leftOut.has(item.row.portalId)}
          isLocked={isLocked}
          onToggle={onToggle}
        />
      ))}
    </ul>
  )
}

export function BatchOutcomeRows({
  rows,
  attempted,
  outcomes,
  unconfirmed,
  sending,
}: Readonly<{
  rows: readonly AffectedPortalRow[]
  attempted: readonly string[]
  outcomes: PublishPortalsChangesResult
  /** Sent in the request that failed as a whole: they may be live. */
  unconfirmed: readonly string[]
  /** Sent again right now: their earlier answer is not the last word. */
  sending: readonly string[]
}>) {
  return (
    <ul aria-label="What happened to each portal" className={LIST}>
      {rows
        .filter((row) => attempted.includes(row.portalId))
        .map((row) => {
          const outcome = outcomes.find((o) => o.portalId === row.portalId)
          const described = sending.includes(row.portalId)
            ? ({ text: 'Trying again…', tone: 'quiet' } as const)
            : outcome === undefined
              ? describeUnanswered(
                  unconfirmed.includes(row.portalId) ? 'unconfirmed' : 'untried',
                )
              : describeOutcome(outcome)
          const Icon =
            described.tone === 'ok'
              ? Check
              : described.tone === 'warn'
                ? CircleAlert
                : Minus
          return (
            <li key={row.portalId} className="border-t first:border-t-0">
              <div className={ROW}>
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    described.tone === 'ok' && 'text-positive',
                    described.tone === 'warn' && 'text-negative',
                    described.tone === 'quiet' && 'text-muted-foreground',
                  )}
                  aria-hidden
                />
                <Names row={row} detail={described.text} tone={described.tone} />
              </div>
            </li>
          )
        })}
    </ul>
  )
}
