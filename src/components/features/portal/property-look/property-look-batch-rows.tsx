// The lists inside the batch "Review & publish" dialog: the live portals with
// what the batch can do with each (a ready one has a tick, which leaves it out
// when cleared), and, once the batch has run, what came of each.
import { Link } from '@tanstack/react-router'
import { Check, CircleAlert, Minus, TriangleAlert } from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import type { PublishPortalsChangesResult } from '#/contexts/portal/application/public-api'
import type { BatchRow } from './use-property-look-batch'
import { describeEntry, describeOutcome } from './property-look-batch-rules'
import type { AffectedPortalRow } from './property-look-rules'

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

function ReviewRow({
  propertyId,
  item,
  isLeftOut,
  onToggle,
}: Readonly<{
  propertyId: string
  item: BatchRow
  isLeftOut: boolean
  onToggle: (portalId: string) => void
}>) {
  const { row, entry } = item
  const detail = describeEntry(entry)
  if (entry.kind === 'ready') {
    const id = `look-batch-${row.portalId}`
    return (
      <li className="border-t first:border-t-0">
        <label htmlFor={id} className={cn(ROW, 'cursor-pointer hover:bg-muted/40')}>
          <Checkbox
            id={id}
            className="mt-0.5"
            checked={!isLeftOut}
            onCheckedChange={() => onToggle(row.portalId)}
          />
          <Names
            row={row}
            detail={isLeftOut ? 'Left out · stays as it is for guests' : detail}
          />
        </label>
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
          <Link
            to="/properties/$propertyId/portals/$portalId/review"
            params={{ propertyId, portalId: row.portalId }}
            aria-label={`Open ${row.name} to fix it`}
            className="shrink-0 text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Open
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function BatchReviewRows({
  propertyId,
  rows,
  leftOut,
  onToggle,
}: Readonly<{
  propertyId: string
  rows: readonly BatchRow[]
  leftOut: ReadonlySet<string>
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
}: Readonly<{
  rows: readonly AffectedPortalRow[]
  attempted: readonly string[]
  outcomes: PublishPortalsChangesResult
}>) {
  return (
    <ul aria-label="What happened to each portal" className={LIST}>
      {rows
        .filter((row) => attempted.includes(row.portalId))
        .map((row) => {
          const outcome = outcomes.find((o) => o.portalId === row.portalId)
          const described =
            outcome === undefined
              ? ({ text: 'Not tried · stopped before it', tone: 'warn' } as const)
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
