import {
  CircleCheck,
  CirclePlus,
  ClipboardCheck,
  History,
  Layers,
  Lock,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import {
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { MESSAGE_PROSE_CLASS } from './guest-message'
import { historyEventLine } from './history-event-line'
import { formatDateTime, formatRelativeTime } from './utils'
import type { InboxHistoryEntry } from './inbox-thread-model'
import type { ReactNode } from 'react'

/** A person named in the line — the actor or the assignee (plan v2.1 row 11). */
const PERSON_CLASS = 'font-medium text-foreground'

function eventIcon(entry: InboxHistoryEntry): ReactNode {
  const { detail } = entry
  if (entry.legacy) return <History className="size-3.5" />
  switch (detail.kind) {
    case 'cycle_opened':
      return detail.openedReason === 'review_observed' ||
        detail.openedReason === 'feedback_submitted' ? (
        <CirclePlus className="size-3.5" />
      ) : (
        <RotateCcw className="size-3.5" />
      )
    case 'cycle_transition':
      return detail.transition === 'closed' ? (
        <CircleCheck className="size-3.5" />
      ) : (
        <RotateCcw className="size-3.5" />
      )
    case 'assignment':
      return detail.nextAssignee === null ? (
        <UserMinus className="size-3.5" />
      ) : (
        <UserPlus className="size-3.5" />
      )
    case 'escalation':
      return detail.escalation === 'escalated' ? (
        <TriangleAlert className="size-3.5" />
      ) : (
        <ShieldCheck className="size-3.5" />
      )
    case 'handling_outcome':
      return <ClipboardCheck className="size-3.5" />
    default:
      return <Layers className="size-3.5" />
  }
}

/**
 * One Handling History entry as a node on the thread's rail — an event, not a
 * message, so it takes the 24 px indicator (row 9) and one line of 13 px text.
 *
 * The node owns its whole `TimelineItem`, not only the content, because the
 * rail forbids an item around nothing (`ui/timeline.tsx`: an empty item still
 * draws a disc and a connector). `historyEventLine` returns `null` for an
 * unknown enum value, a sixth kind, or an `opened` transition, and this
 * component returns `null` with it — so the caller maps entries straight onto
 * the `Timeline` without having to ask first whether each one will speak.
 *
 * The line's own paragraph is plain inline text with real spaces, not a flex
 * row with a `gap`: flex drops the whitespace text nodes between its items, and
 * the paragraph's text — what a screen reader reads, what a copy picks up, and
 * what `getByText('Reopened — new information')` matches in
 * `activity-notification-facts.spec.ts` — would lose every space between the
 * name and the verb. `leading-5` plus `py-1.5` puts the first line in the same
 * 32 px band the indicator's slot occupies, so the words centre on the disc and
 * a wrapped line simply grows the node.
 *
 * `wrap-anywhere` because the two names in the line are not ours to shorten: a
 * display name is whatever the member typed, and one without a space (an email
 * address used as a name) does not break at `whitespace`. Measured in Chromium
 * against `pnpm storybook` with a 300-character actor, the line pushed the
 * thread 1204 px past its 720 px pane at a 1440 px viewport, 1566 px past its
 * 358 px pane at 390 and 1636 px past its 288 px pane at 320; with it, zero. Ordinary words still break only at their spaces.
 *
 * Row 11 asks for the time in the tertiary text colour. It is not: in this
 * repo's tokens `--text-tertiary` on `--surface` measures 2.67:1 light and
 * 3.13:1 dark (oklch → sRGB relative luminance), and 13 px text needs 4.5:1
 * (WCAG 1.4.3). The time takes the verb's `text-muted-foreground` (6.53:1 light,
 * 7.04:1 dark) and its rank comes from its place — last, after a separator.
 */
export function HistoryEventNode({
  entry,
}: Readonly<{ entry: InboxHistoryEntry }>): ReactNode {
  const line = historyEventLine(entry)
  if (!line) return null

  const at =
    typeof entry.occurredAt === 'string' ? new Date(entry.occurredAt) : entry.occurredAt

  return (
    <TimelineItem>
      <TimelineIndicator size="sm">{eventIcon(entry)}</TimelineIndicator>
      <TimelineConnector />
      <TimelineContent>
        <p className="py-1.5 text-[13px] leading-5 wrap-anywhere text-muted-foreground">
          {line.actor ? (
            <>
              <span className={PERSON_CLASS}>{line.actor}</span>{' '}
            </>
          ) : null}
          {/* One text node, always: a reason rides inside the verb, so a pinned
              phrase such as `Reopened — new information` is never split across
              elements. */}
          <span>{line.verb}</span>
          {line.object ? (
            <>
              {' '}
              <span className={PERSON_CLASS}>{line.object}</span>
            </>
          ) : null}
          {line.clause ? <span>{` · ${line.clause}`}</span> : null}
          <span>{' · '}</span>
          <time dateTime={at.toISOString()} title={formatDateTime(at)}>
            {formatRelativeTime(at)}
          </time>
        </p>
        {line.body ? (
          <p
            className={cn(
              MESSAGE_PROSE_CLASS,
              'mb-1 flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground',
            )}
          >
            {/* The privacy marker on a MANAGER'S NOTE INSIDE AN OUTCOME ROW.
                It speaks the same promise `note-message.tsx` puts in a note's
                accessible name (`…, not visible to the guest`), so the rail
                makes one promise for both kinds of private text. It keeps a
                lock where the note has none: row 12 removed the note's lock
                because the note's own box — its label, its dashed edge — already
                marks it, while this glyph is the only thing marking a manager's
                words that sit in the event column rather than in a note. It carries its words as an
                `aria-label` on a `role="img"` wrapper rather than an `sr-only`
                span, so the paragraph's text stays the manager's note and
                nothing else — the note the guest may never see is not something
                to interleave a label into. The glyph renders only where a note
                does, so it is a marker ON the note and never a sign that one was
                withheld. */}
            {line.internal ? (
              <span
                role="img"
                aria-label="Internal note, not visible to the guest"
                className="mt-0.5 shrink-0"
              >
                <Lock className="size-3.5" />
              </span>
            ) : null}
            {line.body}
          </p>
        ) : null}
      </TimelineContent>
    </TimelineItem>
  )
}
