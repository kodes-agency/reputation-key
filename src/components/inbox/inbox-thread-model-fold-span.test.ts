// What a fold may hide, and so where its marker may stand (plan v2.1 row 13,
// amended in PR 3's review): the folded span is the UNBROKEN run of system
// events directly after the review. A note, the reply, or an event that carries
// a person's words ends the run, and a run shorter than four does not fold.
//
// Two findings drove it, and each has its fixture below:
//
// - ORDER. Row 13 fixed the marker directly after the review and hid "all but
//   the newest three" events. When a note or the reply sat AMONG the hidden
//   events, it rendered below a marker holding events newer than it — `guest ·
//   Show 4 earlier events · note@5h · reply@7h · e5…` over e3@6h and e4@8h —
//   and opening the fold split the revealed events around the note instead of
//   putting them after the toggle. No single marker can stand in for events on
//   both sides of an entry that stays visible, so the span must not contain one.
// - WORDS. An outcome's internal note and a manual reopen's explanation are a
//   manager's text riding on a `kind: 'event'` entry. Row 13 folds only what
//   the system recorded, so an event whose line has a `body` never folds either.
//
// The invariant every case asserts is `unfold(folded) === built`: putting the
// marker's events back where the marker stands reproduces the built thread
// exactly, so the reader's order is the record's order, folded or open.
import { describe, expect, it } from 'vitest'
import type { InboxNoteView } from '#/contexts/inbox/application/public-api'
import { inboxItemId, inboxNoteId, organizationId, userId } from '#/shared/domain/ids'
import {
  buildThread,
  foldEarlierEvents,
  type InboxHistoryEntry,
  type LedgerEntry,
  type ReplyView,
  type ThreadEntry,
} from './inbox-thread-model'

const ITEM_ID = inboxItemId('11111111-1111-4111-8111-111111111111')
const USER_ID = userId('user-1')
type Detail = InboxHistoryEntry['detail']

/** Hour `n` after midnight on the source day, so fixtures read as a timeline. */
function hour(n: number): Date {
  return new Date(Date.UTC(2026, 7, 26, n))
}

function makeEvent(id: string, at: Date, detail?: Detail): InboxHistoryEntry {
  const shown = detail ?? { kind: 'escalation', escalation: 'escalated' }
  return {
    id,
    inboxItemId: ITEM_ID,
    kind: shown.kind,
    occurredAt: at,
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: USER_ID,
    actorDisplayName: 'Grace',
    legacy: false,
    detail: shown,
  }
}

function makeNote(id: string, at: Date): InboxNoteView {
  return {
    id: inboxNoteId(id),
    inboxItemId: ITEM_ID,
    organizationId: organizationId('org-1'),
    userId: USER_ID,
    text: 'Called the guest back.',
    createdAt: at,
    displayName: 'Grace',
  }
}

function outcome(internalNote?: string): Detail {
  return {
    kind: 'handling_outcome',
    outcome: 'follow_up_completed',
    outcomeRevision: 1,
    deadlineResult: 'on_time',
    completionAt: hour(0),
    supersedesOutcomeId: null,
    ...(internalNote === undefined ? {} : { internalNote }),
  }
}

const reopenWith = (manualReopenExplanation: string | null): Detail => ({
  kind: 'cycle_opened',
  openedReason: 'manual_reopen',
  manualReopenReason: 'other',
  manualReopenExplanation,
  supersedesCycleNumber: 1,
  sourceRevision: 1,
})

/** `e<hour>` escalations, one per hour given. */
const eventsAt = (...hours: number[]) => hours.map((h) => makeEvent(`e${h}`, hour(h)))

function thread(
  history: readonly InboxHistoryEntry[],
  notes: readonly InboxNoteView[] = [],
  reply: ReplyView | null = null,
): readonly ThreadEntry[] {
  return buildThread({ sourceDate: hour(0), history, notes, reply })
}

function describeEntry(entry: LedgerEntry): string {
  if (entry.kind === 'fold')
    return `fold[${entry.events.map((e) => e.entry.id).join(',')}]`
  if (entry.kind === 'event') return entry.entry.id
  if (entry.kind === 'note') return `note:${entry.note.id}`
  return entry.kind
}

/** The marker's events back in the marker's place — what opening the fold reads. */
function unfold(entries: readonly LedgerEntry[]): readonly ThreadEntry[] {
  return entries.flatMap((entry): readonly ThreadEntry[] =>
    entry.kind === 'fold' ? entry.events : [entry],
  )
}

describe('foldEarlierEvents — the span holds nothing a person wrote', () => {
  it('does not fold past a note or the reply that sit among the oldest events', () => {
    // Arrange — the review's fixture: e2, e4, note@5, e6, reply@7, e8…e14.
    // "All but the newest three" would have hidden e2…e8 around both.
    const reply = { status: 'rejected', updatedAt: hour(7) } as unknown as ReplyView
    const built = thread(
      eventsAt(2, 4, 6, 8, 10, 12, 14),
      [makeNote('n5', hour(5))],
      reply,
    )

    // Act
    const folded = foldEarlierEvents(built)

    // Assert — the run before the note is two events, under four: no fold.
    expect(folded).toBe(built)
  })

  it('folds the run that ends at a note, and leaves the note right after the marker', () => {
    // Arrange — e1…e5, then a note, then e7…e10: nine events, so up to six may
    // fold, but the note ends the run at five.
    const built = thread(eventsAt(1, 2, 3, 4, 5, 7, 8, 9, 10), [makeNote('n6', hour(6))])

    // Act
    const folded = foldEarlierEvents(built)

    // Assert — everything below the marker is newer than everything in it.
    expect(folded.map(describeEntry)).toEqual([
      'guest',
      'fold[e1,e2,e3,e4,e5]',
      'note:n6',
      'e7',
      'e8',
      'e9',
      'e10',
    ])
    expect(unfold(folded)).toEqual(built)
  })

  it('folds a run of exactly four and not one of three', () => {
    // Arrange — nine events each time; only where the note falls differs.
    const fourThenNote = thread(eventsAt(1, 2, 3, 4, 6, 7, 8, 9, 10), [
      makeNote('n5', hour(5)),
    ])
    const threeThenNote = thread(eventsAt(1, 2, 3, 5, 6, 7, 8, 9, 10), [
      makeNote('n4', hour(4)),
    ])

    // Act / Assert
    expect(foldEarlierEvents(fourThenNote).map(describeEntry).slice(0, 3)).toEqual([
      'guest',
      'fold[e1,e2,e3,e4]',
      'note:n5',
    ])
    expect(foldEarlierEvents(threeThenNote)).toBe(threeThenNote)
  })

  it('never folds the reply, and never folds past it', () => {
    // Arrange — a rejected reply whose printed instant (`updatedAt`) falls after
    // the first event of eight.
    const reply = { status: 'rejected', updatedAt: hour(2) } as unknown as ReplyView
    const built = thread(eventsAt(1, 3, 4, 5, 6, 7, 8, 9), [], reply)

    // Act / Assert
    expect(foldEarlierEvents(built)).toBe(built)
  })

  it('never folds an outcome that carries an internal note, and stops the run at it', () => {
    // Arrange — the manager's note on how the guest was handled, third of nine.
    const history = [
      ...eventsAt(1, 2),
      makeEvent('outcome3', hour(3), outcome('Arranged a boiler service.')),
      ...eventsAt(4, 5, 6, 7, 8, 9),
    ]
    const built = thread(history)

    // Act / Assert — it still counts as an event; it just cannot be hidden.
    expect(foldEarlierEvents(built)).toBe(built)
  })

  it('never folds a manual reopen that carries its explanation', () => {
    // Arrange — the explanation lands after five plain events of nine.
    const history = [
      ...eventsAt(1, 2, 3, 4, 5),
      makeEvent('reopen6', hour(6), reopenWith('Regional manager asked for a call.')),
      ...eventsAt(7, 8, 9),
    ]
    const built = thread(history)

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(folded.map(describeEntry)).toEqual([
      'guest',
      'fold[e1,e2,e3,e4,e5]',
      'reopen6',
      'e7',
      'e8',
      'e9',
    ])
    expect(unfold(folded)).toEqual(built)
  })

  it('folds an outcome or a reopen with no words like any system event', () => {
    // Arrange — an absent note is what an unauthorized read AND a note-free
    // outcome return, and an empty explanation is none: the fold must treat
    // all three alike, or the rail's shape would say a note exists.
    const history = [
      makeEvent('outcome1', hour(1), outcome()),
      makeEvent('outcome2', hour(2), outcome('')),
      makeEvent('reopen3', hour(3), reopenWith('')),
      ...eventsAt(4, 5, 6, 7),
    ]
    const built = thread(history)

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(folded.map(describeEntry)).toEqual([
      'guest',
      'fold[outcome1,outcome2,reopen3,e4]',
      'e5',
      'e6',
      'e7',
    ])
    expect(unfold(folded)).toEqual(built)
  })
})
