import type {
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'
import type { GetInboxItemHistoryResult } from '#/contexts/inbox/application/use-cases/get-inbox-item-history'
import { historyEventLine } from './history-event-line'

/**
 * Handling History's entry spelled through the application layer: eslint
 * `boundaries` forbids components reaching into a context's domain folder, and
 * `public-api.ts` does not re-export the domain type.
 */
export type InboxHistoryEntry = GetInboxItemHistoryResult['entries'][number]

/** The reply exactly as `getInboxItemDetail` attaches it to the detail. */
export type ReplyView = NonNullable<InboxItemDetailResult['reply']>
/** A Review-owned Reply, excluding a provider observation presented beside it. */
export type ReplyEntityView = Exclude<ReplyView, { kind: 'google_observation' }>

export type ThreadEntry =
  | Readonly<{ kind: 'guest'; at: Date }>
  | Readonly<{ kind: 'event'; at: Date; entry: InboxHistoryEntry }>
  | Readonly<{ kind: 'note'; at: Date; note: InboxNoteView }>
  | Readonly<{ kind: 'reply'; at: Date; reply: ReplyView }>

export type BuildThreadInput = Readonly<{
  sourceDate: Date
  history: readonly InboxHistoryEntry[]
  notes: readonly InboxNoteView[]
  reply: ReplyView | null
}>

/**
 * A server fn serializes a `Date` over the wire, so the runtime value can be a
 * string while the type still says `Date` — the guard every inbox component
 * already carries. Constructing a new Date also leaves the caller's objects
 * unaliased, so nothing downstream can reach the query cache through `at`.
 */
function instant(value: Date | string): Date {
  return new Date(value)
}

/**
 * The instant the reply MESSAGE prints, selected field-for-field from
 * `presentReplyMessage`'s `meta.at` (`reply-message-view.ts`) through the
 * `resolveReplyView` order it keys off (`reply-status-view.tsx`) — the tests in
 * this file's suite are the same order, state for state.
 *
 * The selection is duplicated here rather than imported: the presenter takes a
 * `ResolvedReplyView`, which only `reply-status-view.tsx` produces, and a
 * runtime import from a `.tsx` module would pull the whole reply editor tree
 * into this pure builder and into its unit test. The duplicate cannot drift
 * silently — `inbox-thread-model.test.ts` feeds one fixture to both and asserts
 * the sort key equals the printed instant for every state the resolver returns.
 *
 * `failed-check` and `failed-retry` collapse into the one `publish_failed`
 * branch because both print `Confirmed · <approvedAt>`. `null` means the
 * message prints no timestamp at all.
 */
function replyMessageInstant(reply: ReplyView): Date | string | null {
  if (reply.status === 'draft') return null
  if (reply.status === 'pending_approval') return reply.submittedAt
  if (reply.status === 'approved') return reply.approvedAt
  if (reply.source === 'google_sync') return reply.publishedAt
  if (reply.status === 'published') return reply.publishedAt
  if (reply.status === 'publish_failed') return reply.approvedAt
  if (reply.status === 'rejected') return reply.updatedAt
  return null
}

/**
 * Sorting on `updatedAt` put the reply at an instant its own message never
 * prints: `buildReplySetClause` rewrites `updatedAt` on every reply mutation
 * and the command store bumps it on every publication attempt, while the
 * milestone the message shows is written once. A reply approved on Monday
 * whose publication settled on Friday therefore sorted below the notes and
 * events of Tuesday to Thursday while reading `Confirmed · 4d ago`, and a
 * `Try publishing again` click moved the message to the foot of the stream out
 * from under the pointer.
 *
 * `updatedAt` survives only as the fallback for the cases where the message
 * shows no instant to disagree with: a draft, which renders nothing in the
 * thread at all, and a missing milestone, where the meta line is dropped
 * rather than printed empty. `rejected` reads `updatedAt` in both places
 * already — `ReplyView` carries `rejectedBy` but no `rejectedAt`.
 */
function replyInstant(reply: ReplyView): Date {
  return instant(replyMessageInstant(reply) ?? reply.updatedAt)
}

export function buildThread(input: BuildThreadInput): readonly ThreadEntry[] {
  const events: readonly ThreadEntry[] = input.history.map((entry) => ({
    kind: 'event',
    at: instant(entry.occurredAt),
    entry,
  }))
  const notes: readonly ThreadEntry[] = input.notes.map((note) => ({
    kind: 'note',
    at: instant(note.createdAt),
    note,
  }))
  const reply: readonly ThreadEntry[] = input.reply
    ? [{ kind: 'reply', at: replyInstant(input.reply), reply: input.reply }]
    : []

  // The base order is the stream each entry arrived on: history first, in the
  // exact order the server sent it, then notes, then the reply.
  // `Array.prototype.sort` has been required to be stable since ES2019 and is
  // stable in every engine this repo targets, so entries sharing an instant
  // keep that base order. History's own total order — (occurredAt,
  // cycleNumber, stateRevision, kind, id), applied twice server-side — is
  // therefore preserved without being recomputed here, and a note written at
  // the same instant as an event reads after the event it followed.
  const ordered = [...events, ...notes, ...reply].sort(
    (left, right) => left.at.getTime() - right.at.getTime(),
  )

  // The guest message is the subject of the thread rather than an entry in it,
  // so it leads even when a history row predates the source date — a
  // backfilled `cycle_opened` routinely does.
  return [{ kind: 'guest', at: instant(input.sourceDate) }, ...ordered]
}

/**
 * A system-event entry — the only kind a fold may hide, and only when it
 * carries no person's words (`isHideableEvent`).
 */
export type EventThreadEntry = Extract<ThreadEntry, { kind: 'event' }>

/**
 * The one marker a folded thread carries in place of its earlier events —
 * `Show N earlier events`, where N is `events.length` (plan v2.1 row 13).
 *
 * `events` are the hidden entries themselves, oldest first, rather than a bare
 * count: the count is derived from them, so the two cannot disagree, and the
 * rows the marker stands for stay inspectable without a second walk of the
 * thread. They are also exactly the entries that FOLLOW the marker's position
 * in the built thread (`foldEarlierEvents`, WHAT MAY BE HIDDEN), so opening the
 * fold is the built thread with the marker kept in front of them
 * (`inbox-thread.tsx` holds the flag).
 *
 * `at` is the oldest hidden event's instant, so every member of `LedgerEntry`
 * still answers `entry.at`. Nothing sorts on it: the marker is PLACED, directly
 * after the guest node, never ordered.
 */
export type FoldedEventsEntry = Readonly<{
  kind: 'fold'
  at: Date
  events: readonly EventThreadEntry[]
}>

/**
 * What the rail renders: a built thread, possibly folded.
 *
 * A union of its own rather than a fifth `ThreadEntry` member, for two reasons.
 * `buildThread` never emits a fold, so widening its return type would make
 * every consumer of the builder handle a kind it cannot receive. And the fold
 * is still impossible to render silently: `foldEarlierEvents` returns this
 * type, which no parameter typed `ThreadEntry` accepts, so the first switch
 * that renders a folded thread has to be retyped to `LedgerEntry` — at which
 * point `inbox-thread.tsx`'s `noRowFor` / `noKeyFor` never-arms stop compiling
 * until `'fold'` has an arm of its own. Those guards exist because a
 * `default:` once rendered the guest's review a second time for an unknown
 * kind; the test file pins that a switch missing `'fold'` fails `tsc`.
 */
export type LedgerEntry = ThreadEntry | FoldedEventsEntry

/**
 * Fold only when the thread holds MORE than this many system events. Row 13
 * sized it from the 390 px sheet: 844 − 52 header − 52 toolbar − 68 collapsed
 * dock leaves 672 px; the review takes ≈260, and three 44 px event rows, a note
 * and the newest reply fit in the rest.
 */
export const EVENT_FOLD_THRESHOLD = 6

/** The newest events a fold leaves on the rail. */
export const EVENTS_KEPT_UNFOLDED = 3

/**
 * The fewest rows a fold may hide. The relation of the two constants above
 * gives it for the largest span a fold may take — at 7 events, all but 3 is 4
 * — but the span can end sooner (WHAT MAY BE HIDDEN), so it is also checked.
 */
export const FEWEST_EVENTS_FOLDED = EVENT_FOLD_THRESHOLD + 1 - EVENTS_KEPT_UNFOLDED

/**
 * Whether a fold may hide this entry: a system event whose line carries no
 * person's words. `historyEventLine`'s `body` is a handling outcome's internal
 * note or a manual reopen's explanation (`history-event-line.ts`) — text a
 * manager wrote, riding on a `kind: 'event'` entry — and row 13 folds only what
 * the system recorded, exactly as a free-standing note never folds.
 *
 * The body is read through the line builder rather than off the detail, so the
 * fold and the node can never disagree about whether words are shown. It is
 * `null` alike for an outcome with no note and for a reader not allowed to see
 * one (the key is absent in both), so the rail's SHAPE says no more about a
 * withheld note than the row itself does.
 */
function isHideableEvent(entry: ThreadEntry): entry is EventThreadEntry {
  return entry.kind === 'event' && (historyEventLine(entry.entry)?.body ?? null) === null
}

/**
 * Collapse the oldest system events into one `fold` marker placed directly
 * after the guest node, once the thread holds more than
 * `EVENT_FOLD_THRESHOLD` of them (plan v2.1 row 13, amended in PR 3's review).
 *
 * WHAT MAY BE HIDDEN. The unbroken run of hideable events that directly follows
 * the guest, and never more than all but the newest `EVENTS_KEPT_UNFOLDED`.
 * The run ends at the first entry a fold may not hide — a note, the reply, or
 * an event carrying a person's words (`isHideableEvent`). Row 13 as written hid
 * "all but the newest three" wherever notes fell, which put a note or the reply
 * that sat AMONG the hidden events below a marker holding events newer than it:
 * `guest · Show 4 earlier events · note@5h · reply@7h · e5…` over e3@6h and
 * e4@8h, and on opening, the revealed events split around the note instead of
 * following the toggle. One marker cannot stand for events on both sides of an
 * entry that stays on the rail, so the span never contains one. Hence the
 * invariant the tests hold every case to: replacing the marker with its events
 * reproduces the built thread exactly, folded or open.
 *
 * THE GUARANTEE. A fold hides at least `FEWEST_EVENTS_FOLDED` (4) rows. A
 * marker reading `Show 1 earlier event` — a click that reveals one row the
 * marker itself nearly occupies — cannot be produced, and neither can a fold
 * of 2 or 3: a run that ends sooner than four does not fold at all, and the
 * thread keeps every row. That is the price of the order above, and it is paid
 * in height, never in truth. The function takes no `max` parameter, although
 * the plan's sketch named one (`foldEarlierEvents(entries, max)`): the
 * guarantee is a relation between the constants, and a caller passing its own
 * threshold of 4 would fold a single row.
 *
 * "NEWEST" IS POSITIONAL. The newest three are the last three event entries in
 * the built thread, which `buildThread` has already ordered by instant, with
 * the server's order breaking ties — so no second clock is consulted here, and
 * a tie cannot be broken differently from the order the rail prints. Every
 * event counts toward the threshold and the three, an event with words
 * included: it is still a system event, it only cannot be hidden.
 *
 * WHAT COUNTS. Every `event` entry it is given. `HistoryEventNode` renders
 * nothing for an entry `historyEventLine` returns `null` for
 * (`history-event-line.ts`: an unknown kind, an opening or outcome with no
 * words), so folding entries the rail will not draw would print a count off by
 * those rows, or keep a "newest three" of which fewer than three appear. Filter
 * them before `buildThread`, beside `saysSomethingNewInTheThread`
 * (`inbox-thread.tsx`) — `historyEventLine(entry) !== null` is that filter.
 *
 * Pure and non-mutating: the input array is never touched, and a thread that
 * does not fold comes back as the same array — it is readonly, so no consumer
 * can write through it.
 */
export function foldEarlierEvents(
  entries: readonly ThreadEntry[],
): readonly LedgerEntry[] {
  const eventCount = entries.filter((entry) => entry.kind === 'event').length
  if (eventCount <= EVENT_FOLD_THRESHOLD) return entries

  // `buildThread` guarantees the guest leads. Should a caller hand over a
  // thread without one, `findIndex` returns -1 and the run starts at the top —
  // the hidden events are never dropped without a marker saying so.
  const start = entries.findIndex((entry) => entry.kind === 'guest') + 1
  const hidden = leadingHideableRun(
    entries.slice(start),
    eventCount - EVENTS_KEPT_UNFOLDED,
  )
  if (hidden.length < FEWEST_EVENTS_FOLDED) return entries

  const marker: FoldedEventsEntry = { kind: 'fold', at: hidden[0].at, events: hidden }
  return [...entries.slice(0, start), marker, ...entries.slice(start + hidden.length)]
}

/**
 * The hideable events at the head of `entries`, at most `cap` of them, stopping
 * at the first entry a fold may not hide. Every entry in the run is an event,
 * so its length is both the number of rows and the number of events taken.
 */
function leadingHideableRun(
  entries: readonly ThreadEntry[],
  cap: number,
): readonly EventThreadEntry[] {
  const end = entries.findIndex(
    (entry, index) => index === cap || !isHideableEvent(entry),
  )
  // The `filter` only narrows the type: every entry before `end` passed it.
  return (end === -1 ? entries : entries.slice(0, end)).filter(isHideableEvent)
}
