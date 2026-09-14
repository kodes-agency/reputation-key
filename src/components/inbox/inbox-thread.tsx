import { useQuery } from '@tanstack/react-query'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { inboxKeys } from '#/shared/queries/query-keys'
import { GuestMessage } from './guest-message'
import { historyEventLine } from './history-event-line'
import { HistoryEventNode } from './history-event-node'
import { buildThread, foldEarlierEvents } from './inbox-thread-model'
import { NoteIndicator, NoteMessage } from './note-message'
import { ReplyMessage } from './reply-message'
import type {
  FoldedEventsEntry,
  InboxHistoryEntry,
  LedgerEntry,
  ThreadEntry,
} from './inbox-thread-model'
import type { InboxDetailFns } from './types'
import type { ReactNode } from 'react'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'

// The thread is ONE rail (plan v2.1 rows 9–13). v1 split the guest's review off
// as a `subject` above the stream, at `gap-6`, then hung events, notes and the
// reply in a `gap-2` column beside a 44 px gutter — a heading over a list, with
// nothing connecting the two (finding 3). Now the review is node zero of a
// single `Timeline`, and every system event, internal note and reply hangs off
// the same connector below it, so the pane reads as the record of a case.
//
// Every node owns its own `TimelineItem`, or composes one here, and the rail's
// children are `TimelineItem`s ONLY (`ui/timeline.tsx`): the last item hides its
// connector through `:last-child`, so a status line rendered inside the rail
// would leave the last entry pointing at nothing. That is why the truncated,
// pending and error lines sit AFTER the `Timeline`, not in it.

/**
 * What the reply message may do, supplied by `inbox-detail-content.tsx`. The
 * thread is presentational: it builds no mutation of its own, so the pane owns
 * one set of reply commands rather than one per region. `onEditPublished` and
 * `onEditRejected` only raise the pane's edit target — the editor itself lives
 * below the scroller until the composer absorbs it.
 *
 * `isEditing` is the other half of that arrangement: the editor mounts outside
 * this subtree, so the reply message cannot see whether its own Edit reply
 * trigger has opened one. Only the pane knows, and the trigger has to say so.
 */
export type ThreadReplyActions = Readonly<{
  isSaving: boolean
  /** Whether the pane's published-reply editor is currently open. */
  isEditing: boolean
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  onCheck: () => Promise<unknown>
  onRetry: () => Promise<unknown>
  onEditPublished: () => void
  onEditRejected: () => void
}>

type Props = Readonly<{
  item: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNoteView>
  currentUserId?: string
  getInboxItemHistory: InboxDetailFns['getInboxItemHistory']
  replyActions: ThreadReplyActions
}>

/**
 * Indent that lines an auxiliary line up with the rail's CONTENT column: the
 * 32 px indicator column plus the 12 px gap (`TimelineItem`'s `gap-3`) is
 * 44 px, `pl-11`. v1's `pl-14` (56 px) matched a 44 px avatar and a 12 px gap
 * that no longer exist. These lines are not nodes — they say something about
 * the history QUERY, not about the case — so they take the column's left edge
 * and no disc, below the rail rather than on it.
 */
const AUX_LINE_INDENT = 'pl-11'

/**
 * Every opening writes TWO rows at the same instant: the `cycle_opened` row and
 * the `opened` / `reopened` `cycle_transition` it produced. `cycle_opened`
 * carries strictly more — the manual reopen reason, its explanation, the
 * superseded cycle — so the transition half would only repeat it. Only a
 * `closed` transition says something no other row does.
 */
function saysSomethingNewInTheThread(entry: InboxHistoryEntry): boolean {
  const { detail } = entry
  return detail.kind !== 'cycle_transition' || detail.transition === 'closed'
}

/**
 * Whether the rail will draw this row at all. `HistoryEventNode` renders
 * nothing for an entry `historyEventLine` cannot put into words — an enum value
 * this bundle has never heard of, a sixth kind — and that silence is right for
 * the node. It is wrong for the FOLD, which counts event entries: a thread of
 * seven rows of which two are unknown would fold at a threshold it does not
 * reach on screen, print `Show 4 earlier events` over three, and keep a "newest
 * three" of which fewer than three appear (`foldEarlierEvents`, WHAT COUNTS).
 * So an unsayable row leaves the thread before `buildThread` sees it.
 *
 * `saysSomethingNewInTheThread` stays beside it rather than being folded in,
 * although `historyEventLine` also returns null for an `opened` transition:
 * that filter states a rule about the RECORD (an opening writes two rows), and
 * this one states a rule about this bundle's vocabulary. Either could change
 * without the other.
 */
function railDrawsEvent(entry: InboxHistoryEntry): boolean {
  return saysSomethingNewInTheThread(entry) && historyEventLine(entry) !== null
}

/**
 * `LedgerEntry` is a contract-shared union the rest of this PR series is still
 * growing, so `ThreadRow`'s last arm has to FAIL THE BUILD rather than pick a
 * row for a kind nobody wrote one for: the parameter is `never`, so a new
 * member stops compiling at the call. Reaching the guest message through
 * `default:` failed OPEN instead — a new member compiled silently and rendered
 * the guest's review a second time, once per entry of the new kind. At runtime
 * this still fails closed: it renders nothing rather than throwing in the pane.
 *
 * It is a parameter rather than the usual `const _never: never = entry`
 * because `noUnusedLocals` rejects that binding (TS6133) — TypeScript's `_`
 * exemption covers parameters only.
 */
function noRowFor(_entry: never): null {
  return null
}

/**
 * The same never-assertion for the React KEY, which had been left reaching
 * `'guest'` through `default:` after `ThreadRow` stopped doing so. That failed
 * open twice over: a new member of the union compiled silently, and every
 * entry of that kind then claimed the one constant key `'guest'` — duplicate
 * keys in a list React reconciles by key, so rows of the new kind would be
 * dropped or reused for each other's data.
 *
 * The runtime fallback is the entry's position, which is unique by
 * construction, so the impossible branch cannot collide with itself either.
 */
function noKeyFor(_entry: never, index: number): string {
  return `unknown:${index}`
}

/**
 * `index` is only ever read by the never arm — see `noKeyFor`.
 *
 * Exported for the stories only, and only because of that arm: the compiler
 * refuses an out-of-union entry, so the one way a test can prove a future kind
 * gets its own key rather than the guest's is to call this directly with a cast
 * fixture. Rendering cannot reach it — `buildThread` and `foldEarlierEvents`
 * only ever emit the five kinds this bundle knows.
 */
export function entryKey(entry: LedgerEntry, index: number): string {
  switch (entry.kind) {
    case 'event':
      return `event:${entry.entry.id}`
    case 'note':
      return `note:${entry.note.id}`
    case 'reply':
      return 'reply'
    case 'guest':
      return 'guest'
    case 'fold':
      // One marker per thread at most (`foldEarlierEvents`), so a constant is
      // unique — and it stays the SAME key when the fold opens and closes, so
      // React keeps the toggle's DOM node, and the focus on it, across the
      // click that relabels it.
      return 'fold'
    default:
      return noKeyFor(entry, index)
  }
}

/**
 * What the rail renders: the built thread folded (row 13), or — once the reader
 * has opened the fold — every entry, with the marker kept in its place.
 *
 * The marker SURVIVES the expansion, relabelled `Hide N earlier events`,
 * rather than vanishing as the canvas implies. A button removed from the DOM by
 * its own click drops keyboard focus to `<body>` (WCAG 2.4.3), so a keyboard or
 * screen-reader user who opened the fold would be thrown back to the top of the
 * page, above the events they asked to see. Kept, the focus stays on the
 * toggle and the revealed events are the next nodes in reading order.
 *
 * That last clause is a property of the model, not of this function:
 * `foldEarlierEvents` hides only the unbroken run of system events directly
 * after the guest (WHAT MAY BE HIDDEN), so the marker's events are exactly the
 * entries that follow its position in the built thread, and no note or reply
 * can sit between them. The marker goes back in front of the first of them —
 * found by identity, so this function states the placement the model chose
 * rather than restating "after the guest" on its own.
 *
 * `foldEarlierEvents` returns the SAME array when there is nothing to fold, so
 * a thread that does not fold has no marker in either state.
 */
function railEntries(
  entries: readonly ThreadEntry[],
  expanded: boolean,
): readonly LedgerEntry[] {
  const folded = foldEarlierEvents(entries)
  if (!expanded) return folded
  const marker = folded.find((entry): entry is FoldedEventsEntry => entry.kind === 'fold')
  if (!marker) return entries
  const at = entries.indexOf(marker.events[0])
  return [...entries.slice(0, at), marker, ...entries.slice(at)]
}

/**
 * Row 13's fold node: a 24 px system-event disc beside the toggle.
 *
 * The button lives in `TimelineContent`, never in the indicator — the
 * indicator is `aria-hidden`, and `aria-hidden-focus` is disabled globally in
 * `.storybook/preview.tsx`, so no gate would catch a focusable control hidden
 * from assistive tech (`ui/timeline.tsx`). The chevrons are decoration; the
 * label says what the click does.
 *
 * The toggle tells assistive tech three things, because a label swap alone
 * told it one. PR 3's review drove it in Chromium against `pnpm storybook`
 * (Tab, Enter on `Inbox/Thread/Folded History` at 1440, 390 and 320): focus
 * stayed on the button and its name changed, but it carried no
 * `aria-expanded` and the document held no live region — and VoiceOver does
 * not speak a name change on the element it is already on, so five events
 * arrived in silence.
 *
 * - The NAME is the visible label, `Show N earlier events` / `Hide N earlier
 *   events`, so the words a speech-control user reads are the words that
 *   activate it (WCAG 2.5.3).
 * - The STATE is `aria-expanded`. It was left off once for fear of `Show 4
 *   earlier events, expanded`; with the label swapping, that pair never
 *   occurs — `Show … collapsed` and `Hide … expanded` each read true.
 * - The RESULT is a polite `role="status"` in the same node, `N earlier events
 *   shown` / `hidden`. It is empty until this reader toggles this item's fold,
 *   so mounting a thread, or selecting another review, announces nothing. It
 *   lives inside the node rather than beside the rail because the rail's
 *   children are `TimelineItem`s only, and the node is keyed `'fold'` in both
 *   states, so the region is the same element before and after the click —
 *   a live region inserted together with its message is not reliably
 *   announced.
 *
 * `N` is always at least 4 (`foldEarlierEvents`, THE GUARANTEE), so the plural
 * is never wrong.
 *
 * Ghost and 13 px, the event line's scale: this is the one control on the rail
 * and it must not outrank the reply's actions. `-ml-3` cancels the button's own
 * `px-3`, so its words start on the content column like every event sentence;
 * the hover fill then reaches back into the 12 px gap, as the canvas draws it.
 * `h-8` sits on the 32 px band an event's first line centres on. Below `md` it
 * is 36 px (`max-md:h-9`) — row 20's control height on the phone sheet,
 * applied here rather than left for PR 5's sweep because the control is new.
 */
function EarlierEventsNode({
  count,
  fold,
}: Readonly<{ count: number; fold: FoldControl }>): ReactNode {
  const { expanded, hasToggled, onToggle } = fold
  const result = expanded ? 'shown' : 'hidden'
  return (
    <TimelineItem>
      <TimelineIndicator size="sm">
        {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
      </TimelineIndicator>
      <TimelineConnector />
      <TimelineContent>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-3 text-[13px] font-medium text-muted-foreground max-md:h-9"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? `Hide ${count} earlier events` : `Show ${count} earlier events`}
        </Button>
        <span role="status" className="sr-only">
          {hasToggled ? `${count} earlier events ${result}` : ''}
        </span>
      </TimelineContent>
    </TimelineItem>
  )
}

/**
 * The fold's state as the node reads it. `hasToggled` is whether THIS reader
 * has toggled THIS item's fold — the one fact that separates a status the
 * reader caused from a thread that merely rendered folded.
 */
type FoldControl = Readonly<{
  expanded: boolean
  hasToggled: boolean
  onToggle: () => void
}>

type FoldToggle = Readonly<{ itemId: InboxItem['id']; expanded: boolean }>

function ThreadRow({
  entry,
  item,
  detail,
  currentUserId,
  replyActions,
  fold,
}: Readonly<{
  entry: LedgerEntry
  item: InboxItem
  detail: InboxItemDetailResult | null
  currentUserId?: string
  replyActions: ThreadReplyActions
  fold: FoldControl
}>): ReactNode {
  switch (entry.kind) {
    case 'event':
      // Owns its `TimelineItem` — and renders none for a row it cannot say.
      return <HistoryEventNode entry={entry.entry} />
    case 'note':
      // The one node composed here: `note-message.tsx` exports the disc and the
      // box apart, and a note always renders, so there is no empty item to
      // guard against. `pb-4` is a message's rhythm (`ui/timeline.tsx`).
      return (
        <TimelineItem className="pb-4">
          <NoteIndicator note={entry.note} />
          <TimelineConnector />
          <TimelineContent>
            <NoteMessage note={entry.note} currentUserId={currentUserId} />
          </TimelineContent>
        </TimelineItem>
      )
    case 'reply':
      // Owns its `TimelineItem`. A draft renders nothing here — `ReplyMessage`
      // returns null for it, because the draft is the composer's, not the
      // thread's — and so draws no disc either.
      return (
        <ReplyMessage
          reply={entry.reply}
          propertyName={item.propertyName}
          {...replyActions}
        />
      )
    case 'guest':
      // Node zero. Owns its `TimelineItem`, and renders none until the detail
      // has arrived.
      return (
        <GuestMessage
          item={item}
          detail={detail}
          reviewReplyLanguage={detail?.reviewReplyLanguage}
        />
      )
    case 'fold':
      return <EarlierEventsNode count={entry.events.length} fold={fold} />
    default:
      return noRowFor(entry)
  }
}

function HistoryPending(): ReactNode {
  return (
    <div className={cn('py-2.5', AUX_LINE_INDENT)} role="status">
      <Skeleton className="h-3 w-40" />
      <span className="sr-only">Loading handling history…</span>
    </div>
  )
}

export function InboxThread({
  item,
  detail,
  notes,
  currentUserId,
  getInboxItemHistory,
  replyActions,
}: Props): ReactNode {
  const { can } = usePermissions()
  const historyQuery = useQuery({
    queryKey: inboxKeys.history(item.id),
    queryFn: () => getInboxItemHistory({ data: { inboxItemId: item.id } }),
    staleTime: 0,
  })

  // Which item's fold the reader toggled, and which way — not a bare boolean.
  // The pane does not key this component by item (`inbox-detail-content.tsx`
  // mounts one thread for the life of the pane), so a `useState(false)` opened
  // on one review would still be open on the next review selected — a fold the
  // new reader never asked for, over a history they have not seen. Holding the
  // id makes a change of selection close the fold without an effect to reset
  // it, and holds no server-owned record: the item id is only compared, never
  // shown or sent. `null` — never toggled — is also what keeps the fold's
  // status region silent until the reader acts (`EarlierEventsNode`).
  const [foldToggle, setFoldToggle] = useState<FoldToggle | null>(null)
  const hasToggled = foldToggle?.itemId === item.id
  const expanded = hasToggled && foldToggle.expanded
  const fold = useMemo<FoldControl>(
    () => ({
      expanded,
      hasToggled,
      onToggle: () => setFoldToggle({ itemId: item.id, expanded: !expanded }),
    }),
    [expanded, hasToggled, item.id],
  )

  // The reply is gated on the same permission as the editor below the
  // scroller. `getInboxItemDetail` already returns `reply: null` without
  // `reply.manage`, so this is belt and braces — but the affordance is the
  // pane's decision to state, not a server nullability to infer.
  const reply = can('reply.manage') ? (detail?.reply ?? null) : null

  const history = useMemo(
    () => (historyQuery.data?.entries ?? []).filter(railDrawsEvent),
    [historyQuery.data],
  )
  const entries = useMemo(
    () => buildThread({ sourceDate: item.sourceDate, history, notes, reply }),
    [item.sourceDate, history, notes, reply],
  )
  const rail = useMemo(() => railEntries(entries, expanded), [entries, expanded])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Timeline>
        {rail.map((entry, index) => (
          <ThreadRow
            key={entryKey(entry, index)}
            entry={entry}
            item={item}
            detail={detail}
            currentUserId={currentUserId}
            replyActions={replyActions}
            fold={fold}
          />
        ))}
      </Timeline>

      {/* `truncated` is a property of the result, not of any entry: one of the
          five sources hit its 200-row limit. The repository does say which end
          was cut — every source reads `ORDER BY … ASC LIMIT 200`, so the rows
          that never arrived are the most RECENT ones, the opposite of what a
          reader assumes from a line above the oldest entry. Hence an
          end-agnostic line, at the foot of the rail. */}
      {historyQuery.data?.truncated ? (
        <p className={cn('text-xs text-muted-foreground', AUX_LINE_INDENT)}>
          Not all handling history is shown
        </p>
      ) : null}

      {historyQuery.isPending ? <HistoryPending /> : null}
      {/* A history read that failed is not an item that failed, so it stays a
          quiet line under the rail rather than a destructive banner over the
          guest's words. */}
      {historyQuery.isError ? (
        <p className={cn('text-xs text-muted-foreground', AUX_LINE_INDENT)} role="status">
          Handling history is unavailable right now.
        </p>
      ) : null}
    </div>
  )
}
