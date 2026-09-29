// DESIGN PROTOTYPE — story-only. Nothing here ships; the `.stories.` segment
// keeps the module out of production inventories and bundles.
//
// Building blocks for the notification redesign directions in
// notification-redesign.stories.tsx. Copy still comes from the one domain
// renderer (`renderNotification`), so the prototypes show real sentences; what
// changes is which of them a row shows, and how.

import { createElement, type ReactNode } from 'react'
import { CheckCircle2, MoreHorizontal } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { StarRating } from '#/components/ui/star-rating'
import { cn } from '#/lib/utils'
import {
  renderNotification,
  waitingAge,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import { getNotificationIcon } from './notification-utils'
import {
  BOILERPLATE_BODY,
  compactTime,
  needsYou,
  STACK_NOUNS,
  stampOf,
  toneOf,
  type FeedEntry,
  type RowTone,
} from './notification-redesign.stories.model'

export {
  byUrgency,
  groupByDate,
  needsYou,
  stackEntries,
} from './notification-redesign.stories.model'

// ── Row ─────────────────────────────────────────────────────────────

const TONE_ICON: Readonly<Record<RowTone, string>> = {
  critical: 'text-destructive',
  'needs-you': 'text-foreground',
  update: 'text-muted-foreground',
  done: 'text-positive',
}

/** The facts beside the sentence, in one muted line. */
function FactsLine({
  row,
  showProperty,
  extra,
}: Readonly<{ row: NotificationView; showProperty: boolean; extra?: ReactNode }>) {
  const p = row.payload
  const waited = waitingAge(p)
  const tone = toneOf(row)
  const parts: ReactNode[] = []
  if (showProperty && p.propertyName) parts.push(<span key="p">{p.propertyName}</span>)
  if (tone === 'done')
    parts.push(
      <span key="d" className="text-positive">
        Done
      </span>,
    )
  if (row.type === 'inbox.response_target_passed' && tone !== 'done')
    parts.push(
      <span key="o" className="font-medium text-destructive">
        Target passed
      </span>,
    )
  if (p.guestRating !== undefined)
    parts.push(
      <StarRating key="r" value={p.guestRating} label={`Rated ${p.guestRating} of 5`} />,
    )
  if (waited !== '' && tone !== 'done') parts.push(<span key="w">waited {waited}</span>)
  if (row.coalescedCount > 1) parts.push(<span key="c">×{row.coalescedCount}</span>)
  if (extra) parts.push(<span key="x">{extra}</span>)
  if (parts.length === 0) return null
  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
    </p>
  )
}

function RowShell({
  unread,
  icon,
  children,
  time,
  label,
  dense,
}: Readonly<{
  unread: boolean
  icon: ReactNode
  children: ReactNode
  time: string
  label: string
  dense?: boolean
}>) {
  return (
    <li
      className={cn(
        'group relative flex gap-3 rounded-md px-3 transition-colors hover:bg-surface-elevated focus-within:bg-surface-elevated',
        dense ? 'py-2' : 'py-2.5',
      )}
    >
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {unread && (
          <span
            aria-hidden="true"
            className="absolute -left-2.5 top-1.5 size-1.5 rounded-full bg-primary"
          />
        )}
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      <time className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
        {time}
      </time>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`More actions for: ${label}`}
        className="relative z-10 -my-0.5 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
    </li>
  )
}

/** The whole row is the link: a stretched pseudo-element over a real <a>. */
function RowLink({
  children,
  unread,
  muted,
}: Readonly<{ children: ReactNode; unread: boolean; muted?: boolean }>) {
  return (
    <a
      href="#"
      onClick={(event) => event.preventDefault()}
      className={cn(
        'block min-w-0 text-sm leading-snug outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50',
        unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
        muted && 'text-muted-foreground',
      )}
    >
      {/* The global `a` rule paints links in the accent; the row title is text. */}
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>
        {children}
      </span>
    </a>
  )
}

export function ProtoRow({
  row,
  showProperty = true,
  dense,
}: Readonly<{ row: NotificationView; showProperty?: boolean; dense?: boolean }>) {
  // Title without " at <Property>": the facts line (or the group heading)
  // names the Property once.
  const titleOnly = renderNotification(row.type, {
    ...row.payload,
    propertyName: undefined,
  })
  const full = renderNotification(row.type, row.payload, { timeZone: 'Europe/Sofia' })
  const tone = toneOf(row)
  const unread = row.status === 'unread' && tone !== 'done'
  const icon =
    tone === 'done'
      ? createElement(CheckCircle2, { className: `size-4 ${TONE_ICON.done}` })
      : createElement(getNotificationIcon(row.type), {
          className: `size-4 ${TONE_ICON[tone]}`,
        })
  const informativeBody = !BOILERPLATE_BODY.has(row.type) && full.body !== ''
  return (
    <RowShell
      unread={unread}
      icon={icon}
      time={compactTime(stampOf(row))}
      label={titleOnly.title}
      dense={dense}
    >
      <RowLink unread={unread} muted={tone === 'done'}>
        {titleOnly.title}
      </RowLink>
      <FactsLine row={row} showProperty={showProperty} />
      {informativeBody && !dense && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {full.body}
        </p>
      )}
    </RowShell>
  )
}

export function ProtoStackRow({
  rows,
  showProperty = true,
  dense,
}: Readonly<{ rows: NotificationView[]; showProperty?: boolean; dense?: boolean }>) {
  const first = rows[0]!
  const noun = STACK_NOUNS[first.type]?.(rows.length) ?? `${rows.length} updates`
  const unread = rows.some((row) => row.status === 'unread')
  const ratings = rows
    .map((row) => row.payload.guestRating)
    .filter((rating): rating is NonNullable<typeof rating> => rating !== undefined)
  const lowest = ratings.length > 0 ? Math.min(...ratings) : undefined
  return (
    <RowShell
      unread={unread}
      icon={createElement(getNotificationIcon(first.type), {
        className: `size-4 ${needsYou(first) ? TONE_ICON['needs-you'] : TONE_ICON.update}`,
      })}
      time={compactTime(stampOf(first))}
      label={noun}
      dense={dense}
    >
      <RowLink unread={unread}>{noun}</RowLink>
      <FactsLine
        row={{
          ...first,
          coalescedCount: 1,
          payload: { ...first.payload, guestRating: undefined, waitedHours: undefined },
        }}
        showProperty={showProperty}
        extra={lowest !== undefined ? `lowest ${lowest}★` : undefined}
      />
    </RowShell>
  )
}

export function ProtoEntries({
  entries,
  showProperty = true,
  dense,
}: Readonly<{
  entries: ReadonlyArray<FeedEntry>
  showProperty?: boolean
  dense?: boolean
}>) {
  return (
    <ul className="flex flex-col">
      {entries.map((entry) =>
        entry.kind === 'row' ? (
          <ProtoRow
            key={entry.row.id}
            row={entry.row}
            showProperty={showProperty}
            dense={dense}
          />
        ) : (
          <ProtoStackRow
            key={entry.key}
            rows={entry.rows}
            showProperty={showProperty}
            dense={dense}
          />
        ),
      )}
    </ul>
  )
}

export function SectionLabel({
  children,
  count,
  action,
}: Readonly<{ children: ReactNode; count?: number; action?: ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
      <h3 className="text-xs font-semibold text-muted-foreground">
        {children}
        {count !== undefined && (
          <span className="ml-1.5 font-medium tabular-nums text-foreground">{count}</span>
        )}
      </h3>
      {action}
    </div>
  )
}
