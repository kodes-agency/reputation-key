// `foldEarlierEvents` (plan v2.1 row 13) in a file of its own: the builder's
// suite, `inbox-thread-model.test.ts`, stands at 295 of the 300 counted lines
// ESLint `max-lines` allows under `src/components`, and the fold is a separate
// pass over the builder's output rather than part of building it.
//
// Every fixture goes THROUGH `buildThread`, never around it: the rule is that
// the newest events are the newest by position in the BUILT thread, so a
// hand-assembled array would test an order the rail never receives.
//
// What may sit INSIDE the folded span — a note, the reply, an event carrying a
// person's words — is `inbox-thread-model-fold-span.test.ts`.
import { describe, expect, it } from 'vitest'
import type { InboxNoteView } from '#/contexts/inbox/application/public-api'
import { inboxItemId, inboxNoteId, organizationId, userId } from '#/shared/domain/ids'
import {
  buildThread,
  EVENT_FOLD_THRESHOLD,
  EVENTS_KEPT_UNFOLDED,
  FEWEST_EVENTS_FOLDED,
  foldEarlierEvents,
  type InboxHistoryEntry,
  type LedgerEntry,
  type ReplyView,
  type ThreadEntry,
} from './inbox-thread-model'

/** Fixed clock: the repo forbids tests that read the wall clock. */
const SOURCE_DATE = new Date('2026-08-26T09:00:00.000Z')
const ITEM_ID = inboxItemId('11111111-1111-4111-8111-111111111111')
const USER_ID = userId('user-1')

/** Minute `n` after 10:00 on the source day, so fixtures read as a timeline. */
function minute(n: number): Date {
  return new Date(Date.UTC(2026, 7, 26, 10, n))
}

function makeEvent(id: string, occurredAt: Date): InboxHistoryEntry {
  return {
    id,
    inboxItemId: ITEM_ID,
    kind: 'escalation',
    occurredAt,
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: USER_ID,
    actorDisplayName: 'Grace',
    legacy: false,
    detail: { kind: 'escalation', escalation: 'escalated' },
  }
}

function makeNote(id: string, createdAt: Date): InboxNoteView {
  return {
    id: inboxNoteId(id),
    inboxItemId: ITEM_ID,
    organizationId: organizationId('org-1'),
    userId: USER_ID,
    text: 'Called the guest back.',
    createdAt,
    displayName: 'Grace',
  }
}

/** Events `e1`…`eN`, ten minutes apart from 10:00, oldest first. */
function events(count: number): InboxHistoryEntry[] {
  return Array.from({ length: count }, (_, i) => makeEvent(`e${i + 1}`, minute(i * 10)))
}

function thread(
  history: readonly InboxHistoryEntry[],
  notes: readonly InboxNoteView[] = [],
  reply: ReplyView | null = null,
): readonly ThreadEntry[] {
  return buildThread({ sourceDate: SOURCE_DATE, history, notes, reply })
}

/** Identity of each rendered row; a fold names the events it holds. */
function describeEntry(entry: LedgerEntry): string {
  if (entry.kind === 'fold')
    return `fold[${entry.events.map((e) => e.entry.id).join(',')}]`
  if (entry.kind === 'event') return entry.entry.id
  if (entry.kind === 'note') return `note:${entry.note.id}`
  return entry.kind
}

const describeAll = (entries: readonly LedgerEntry[]) => entries.map(describeEntry)

/**
 * `inbox-thread.tsx`'s `noRowFor`, reproduced: a parameter of type `never`.
 * The switch below omits `'fold'`, so `entry` is still `FoldedEventsEntry` in
 * its `default:` and the call must not compile. `pnpm typecheck` covers this
 * file; if the fold ever stopped being a distinct member, the directive would
 * be unused and `tsc` would fail on it instead.
 */
function noRowFor(_entry: never): string {
  return 'unhandled'
}

function rowWithoutAFoldArm(entry: LedgerEntry): string {
  switch (entry.kind) {
    case 'guest':
    case 'event':
    case 'note':
    case 'reply':
      return entry.kind
    default:
      // @ts-expect-error: 'fold' has no arm, so `entry` is not narrowed to never.
      return noRowFor(entry)
  }
}

describe('foldEarlierEvents', () => {
  it('guarantees a fold hides at least four rows', () => {
    // Arrange / Act — the smallest thread that folds, by the constants alone.
    const smallestFold = EVENT_FOLD_THRESHOLD + 1 - EVENTS_KEPT_UNFOLDED

    // Assert — and the floor a shorter span is checked against is that size.
    expect(EVENT_FOLD_THRESHOLD).toBe(6)
    expect(EVENTS_KEPT_UNFOLDED).toBe(3)
    expect(smallestFold).toBeGreaterThanOrEqual(4)
    expect(FEWEST_EVENTS_FOLDED).toBe(smallestFold)
  })

  it('leaves a thread with fewer events than the threshold as it is', () => {
    // Arrange
    const built = thread(events(3), [makeNote('n1', minute(15))])

    // Act
    const folded = foldEarlierEvents(built)

    // Assert — the same array, not a copy with the same rows.
    expect(folded).toBe(built)
    expect(describeAll(folded)).toEqual(['guest', 'e1', 'e2', 'note:n1', 'e3'])
  })

  it('does not fold at exactly six events', () => {
    // Arrange
    const built = thread(events(EVENT_FOLD_THRESHOLD))

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(folded).toBe(built)
    expect(folded.some((entry) => entry.kind === 'fold')).toBe(false)
  })

  it('folds exactly four at seven events, keeping the newest three', () => {
    // Arrange
    const built = thread(events(EVENT_FOLD_THRESHOLD + 1))

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(describeAll(folded)).toEqual(['guest', 'fold[e1,e2,e3,e4]', 'e5', 'e6', 'e7'])
    const marker = folded[1]
    if (marker.kind !== 'fold') throw new Error('expected the marker after the guest')
    expect(marker.events).toHaveLength(4)
    // `at` is the oldest folded event's instant; nothing sorts on it.
    expect(marker.at).toEqual(minute(0))
  })

  it('folds all but the newest three well over the threshold', () => {
    // Arrange / Act
    const folded = foldEarlierEvents(thread(events(12)))

    // Assert
    expect(describeAll(folded)).toEqual([
      'guest',
      'fold[e1,e2,e3,e4,e5,e6,e7,e8,e9]',
      'e10',
      'e11',
      'e12',
    ])
  })

  it('never folds a thread that is all notes', () => {
    // Arrange — ten notes: more rows than any fold threshold, none of them events.
    const notes = Array.from({ length: 10 }, (_, i) => makeNote(`n${i + 1}`, minute(i)))
    const built = thread([], notes)

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(folded).toBe(built)
    expect(folded).toHaveLength(11)
  })

  it('counts only events toward the threshold, never notes or the reply', () => {
    // Arrange — six events and five notes: eleven rows, but not seven events.
    const notes = Array.from({ length: 5 }, (_, i) =>
      makeNote(`n${i + 1}`, minute(i * 10 + 5)),
    )
    const built = thread(events(EVENT_FOLD_THRESHOLD), notes)

    // Act / Assert
    expect(foldEarlierEvents(built)).toBe(built)
  })

  it('puts a note written between the folded and the kept events right after the marker', () => {
    // Arrange — n1 at 10:35 sits between e4 (10:30), the last folded event,
    // and e5 (10:40), the first kept one.
    const built = thread(events(7), [makeNote('n1', minute(35))])

    // Act
    const folded = foldEarlierEvents(built)

    // Assert — the note still reads after the events it followed and before
    // the ones that followed it.
    expect(describeAll(folded)).toEqual([
      'guest',
      'fold[e1,e2,e3,e4]',
      'note:n1',
      'e5',
      'e6',
      'e7',
    ])
  })

  it('leaves a note among the kept events exactly where it was', () => {
    // Arrange — n1 at 10:45, between e5 and e6, both kept.
    const built = thread(events(7), [makeNote('n1', minute(45))])

    // Act / Assert
    expect(describeAll(foldEarlierEvents(built))).toEqual([
      'guest',
      'fold[e1,e2,e3,e4]',
      'e5',
      'note:n1',
      'e6',
      'e7',
    ])
  })

  it('takes the newest three by position when the last events share an instant', () => {
    // Arrange — e4…e7 share one instant, so only the server's order tells them
    // apart. The builder keeps that order; the fold must not re-decide it.
    const shared = minute(30)
    const history = [
      ...events(3),
      ...['e4', 'e5', 'e6', 'e7'].map((id) => makeEvent(id, shared)),
    ]

    // Act
    const folded = foldEarlierEvents(thread(history))

    // Assert
    expect(describeAll(folded)).toEqual(['guest', 'fold[e1,e2,e3,e4]', 'e5', 'e6', 'e7'])
  })

  it('leads with the marker rather than dropping events when no guest leads', () => {
    // Arrange — `buildThread` always emits the guest; this proves the defensive
    // anchor, not a shape the rail can receive.
    const withoutGuest = thread(events(7)).filter((entry) => entry.kind !== 'guest')

    // Act / Assert
    expect(describeAll(foldEarlierEvents(withoutGuest))).toEqual([
      'fold[e1,e2,e3,e4]',
      'e5',
      'e6',
      'e7',
    ])
  })

  it('does not mutate the thread it folds', () => {
    // Arrange — frozen, so any write throws in this strict-mode module. n1 at
    // 10:55 follows e1…e6, the six events a nine-event fold may take, so the
    // fold happens and there is a copy to tell apart from the input.
    const built = Object.freeze([...thread(events(9), [makeNote('n1', minute(55))])])
    const before = describeAll(built)

    // Act
    const folded = foldEarlierEvents(built)

    // Assert
    expect(describeAll(built)).toEqual(before)
    expect(folded).not.toBe(built)
  })

  it('keeps LedgerEntry to the four thread kinds plus the fold', () => {
    // Arrange — the same pin the builder's suite keeps for `ThreadEntry`: a
    // sixth member fails `tsc` here until the rail says how it renders.
    const kinds: Record<LedgerEntry['kind'], true> = {
      guest: true,
      event: true,
      note: true,
      reply: true,
      fold: true,
    }
    const marker = foldEarlierEvents(thread(events(7)))[1]

    // Act / Assert — the switch without a fold arm reaches its never-arm.
    expect(Object.keys(kinds).sort()).toEqual(['event', 'fold', 'guest', 'note', 'reply'])
    expect(rowWithoutAFoldArm(marker)).toBe('unhandled')
  })
})
