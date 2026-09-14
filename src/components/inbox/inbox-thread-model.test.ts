import { describe, expect, it } from 'vitest'
import type { InboxNoteView } from '#/contexts/inbox/application/public-api'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  buildThread,
  type InboxHistoryEntry,
  type ReplyEntityView,
  type ReplyView,
  type ThreadEntry,
} from './inbox-thread-model'
// The presenter is the other half of the sort-key agreement pinned below. It
// is a pure `.ts` module — importing it loads no editor tree, which is exactly
// why the model duplicates its field selection instead of calling it.
import { presentReplyMessage, type ResolvedReplyView } from './reply-message-view'

/** Fixed clock: the repo forbids tests that read the wall clock. */
const SOURCE_DATE = new Date('2026-08-26T09:00:00.000Z')

const ITEM_ID = inboxItemId('11111111-1111-4111-8111-111111111111')
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

function makeEvent(
  id: string,
  occurredAt: string,
  overrides: Partial<InboxHistoryEntry> = {},
): InboxHistoryEntry {
  return {
    id,
    inboxItemId: ITEM_ID,
    kind: 'escalation',
    occurredAt: new Date(occurredAt),
    cycleNumber: 1,
    stateRevision: null,
    actorUserId: USER_ID,
    actorDisplayName: 'Grace',
    legacy: false,
    detail: { kind: 'escalation', escalation: 'escalated' },
    ...overrides,
  }
}

function makeNote(id: string, createdAt: string): InboxNoteView {
  return {
    id: inboxNoteId(id),
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    text: 'Called the guest back.',
    createdAt: new Date(createdAt),
    displayName: 'Grace',
  }
}

/** The milestones a reply message can print, and the publication machine's
 *  last write. All differ, and `updatedAt` is two days after every milestone,
 *  so no assertion below can pass by coincidence. */
const APPROVED_AT = new Date('2026-08-26T10:15:00.000Z')
const PUBLISHED_AT = new Date('2026-08-26T11:45:00.000Z')
const UPDATED_AT = new Date('2026-08-28T17:00:00.000Z')

/** A rejected reply: submitted at 09:30, moved to its current state later. */
function makeReply(
  updatedAt: Date | string,
  overrides: Partial<ReplyEntityView> = {},
): ReplyEntityView {
  return {
    id: replyId('reply-1'),
    reviewId: reviewId('rev-1'),
    organizationId: ORG_ID,
    text: 'Thank you for staying with us.',
    templateId: null,
    templateVersion: null,
    status: 'rejected',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: USER_ID,
    rejectionReason: 'Too formal for this guest.',
    aiGenerated: false,
    stateRevision: 3,
    submittedAt: new Date('2026-08-26T09:30:00.000Z'),
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: new Date('2026-08-26T09:15:00.000Z'),
    updatedAt: new Date(updatedAt),
    ...overrides,
  }
}

/** Identity of each row, so an order assertion reads as the rendered thread. */
function describeEntry(entry: ThreadEntry): string {
  if (entry.kind === 'guest') return 'guest'
  if (entry.kind === 'event') return `event:${entry.entry.id}`
  if (entry.kind === 'note') return `note:${entry.note.id}`
  return `reply:${entry.reply.id}`
}

/** A reply whose `updatedAt` the publication machine has moved past every
 *  milestone — the churn that used to decide where the reply sorted. */
const churned = (fields: Partial<ReplyEntityView> = {}) => makeReply(UPDATED_AT, fields)

const CONFIRMED = { status: 'approved', approvedAt: APPROVED_AT } as const
const LIVE = { status: 'published', publishedAt: PUBLISHED_AT } as const
const FAILED = { status: 'publish_failed', approvedAt: APPROVED_AT } as const
const AMBIGUOUS = { ...FAILED, publicationLastErrorClass: 'ambiguous' } as const

/**
 * One fixture per kind `resolveReplyView` returns (`reply-status-view.tsx`),
 * each carrying the fields that resolve it there. `satisfies Record<…>` is the
 * pin: a new kind fails `tsc` here until the thread says where it sorts.
 */
const REPLY_CASES = {
  compose: { kind: 'compose', reply: churned({ status: 'draft' }) },
  none: { kind: 'none' },
  pending: { kind: 'pending', reply: churned({ status: 'pending_approval' }) },
  approved: { kind: 'approved', reply: churned(CONFIRMED) },
  published: { kind: 'published', reply: churned(LIVE) },
  mirror: { kind: 'mirror', reply: churned({ ...LIVE, source: 'google_sync' }) },
  'failed-check': { kind: 'failed-check', reply: churned(AMBIGUOUS) },
  'failed-retry': { kind: 'failed-retry', reply: churned(FAILED) },
  rejected: { kind: 'rejected', reply: churned({}) },
} satisfies Record<ResolvedReplyView['kind'], ResolvedReplyView>

/** The kinds `ThreadRow` has a row for — see the exhaustiveness test below. */
const ROW_KINDS = { guest: true, event: true, note: true, reply: true } as const

/** A reply above the note and event its printed milestone really precedes. */
const REPLY_LEADS = ['guest', 'reply:reply-1', 'note:note-1', 'event:escalate:1']

/** The instant `buildThread` sorts the reply row on. */
function sortKey(reply: ReplyView | null): Date | null {
  const thread = buildThread({ sourceDate: SOURCE_DATE, history: [], notes: [], reply })
  return thread.find((entry) => entry.kind === 'reply')?.at ?? null
}

describe('buildThread', () => {
  it('leads with the guest message even when a history entry predates it', () => {
    // Arrange — a backfilled opening carries an instant days before the review.
    const backfilled = makeEvent('opened:1', '2026-08-20T00:00:00.000Z', {
      kind: 'cycle_opened',
      legacy: true,
      actorUserId: null,
      actorDisplayName: null,
      detail: {
        kind: 'cycle_opened',
        openedReason: 'legacy_backfill',
        manualReopenReason: null,
        manualReopenExplanation: null,
        supersedesCycleNumber: null,
        sourceRevision: 1,
      },
    })

    // Act
    const thread = buildThread({
      sourceDate: SOURCE_DATE,
      history: [backfilled],
      notes: [],
      reply: null,
    })

    // Assert
    expect(thread.map(describeEntry)).toEqual(['guest', 'event:opened:1'])
    expect(thread[0].at).toEqual(SOURCE_DATE)
  })

  it('orders events, notes and the reply ascending by instant', () => {
    // Arrange
    const history = [
      makeEvent('assign:1', '2026-08-26T12:00:00.000Z', {
        kind: 'assignment',
        detail: {
          kind: 'assignment',
          reason: 'assign',
          previousAssignee: null,
          nextAssignee: USER_ID,
          previousAssigneeDisplayName: null,
          nextAssigneeDisplayName: 'Grace',
          bulkId: null,
        },
      }),
      makeEvent('escalate:1', '2026-08-26T16:00:00.000Z'),
    ]
    const notes = [makeNote('note-1', '2026-08-26T14:00:00.000Z')]

    // Act
    const thread = buildThread({
      sourceDate: SOURCE_DATE,
      history,
      notes,
      reply: makeReply('2026-08-26T18:00:00.000Z'),
    })

    // Assert
    expect(thread.map(describeEntry)).toEqual([
      'guest',
      'event:assign:1',
      'note:note-1',
      'event:escalate:1',
      'reply:reply-1',
    ])
  })

  it('keeps the order the server sent for two history entries at one instant', () => {
    // Arrange — a closing transition and the outcome it completes are written
    // in one transaction and share an instant; only the server's KIND_RANK
    // separates them, so the builder must not decide the pair itself.
    const sharedInstant = '2026-08-26T12:00:00.000Z'
    const transition = makeEvent('transition:1', sharedInstant, {
      kind: 'cycle_transition',
      detail: {
        kind: 'cycle_transition',
        transition: 'closed',
        transitionReason: 'private_feedback_handled',
        actorType: 'user',
      },
    })
    const outcome = makeEvent('outcome:1', sharedInstant, {
      kind: 'handling_outcome',
      detail: {
        kind: 'handling_outcome',
        outcome: 'follow_up_completed',
        outcomeRevision: 1,
        deadlineResult: 'on_time',
        completionAt: new Date(sharedInstant),
        supersedesOutcomeId: null,
      },
    })

    // Act — both orders, because only an unstable sort would agree with one.
    const asSent = buildThread({
      sourceDate: SOURCE_DATE,
      history: [transition, outcome],
      notes: [],
      reply: null,
    })
    const reversed = buildThread({
      sourceDate: SOURCE_DATE,
      history: [outcome, transition],
      notes: [],
      reply: null,
    })

    // Assert
    expect(asSent.map(describeEntry)).toEqual([
      'guest',
      'event:transition:1',
      'event:outcome:1',
    ])
    expect(reversed.map(describeEntry)).toEqual([
      'guest',
      'event:outcome:1',
      'event:transition:1',
    ])
  })

  it('keeps a note after the event it shares an instant with', () => {
    // Arrange
    const sharedInstant = '2026-08-26T12:00:00.000Z'

    // Act
    const thread = buildThread({
      sourceDate: SOURCE_DATE,
      history: [makeEvent('escalate:1', sharedInstant)],
      notes: [makeNote('note-1', sharedInstant)],
      reply: null,
    })

    // Assert
    expect(thread.map(describeEntry)).toEqual([
      'guest',
      'event:escalate:1',
      'note:note-1',
    ])
  })

  it('returns the guest message alone when there is nothing else to show', () => {
    // Arrange / Act
    const thread = buildThread({
      sourceDate: SOURCE_DATE,
      history: [],
      notes: [],
      reply: null,
    })

    // Assert
    expect(thread).toEqual([{ kind: 'guest', at: SOURCE_DATE }])
  })

  it('omits the reply row entirely when there is no reply', () => {
    // Arrange / Act
    const thread = buildThread({
      sourceDate: SOURCE_DATE,
      history: [makeEvent('escalate:1', '2026-08-26T12:00:00.000Z')],
      notes: [makeNote('note-1', '2026-08-26T13:00:00.000Z')],
      reply: null,
    })

    // Assert
    expect(thread.some((entry) => entry.kind === 'reply')).toBe(false)
    expect(thread).toHaveLength(3)
  })

  it('does not mutate the arrays or the dates it is given', () => {
    // Arrange — deliberately out of order, so a naive in-place sort shows up.
    const history = [
      makeEvent('escalate:1', '2026-08-26T16:00:00.000Z'),
      makeEvent('assign:1', '2026-08-26T12:00:00.000Z'),
    ]
    const notes = [makeNote('note-1', '2026-08-26T14:00:00.000Z')]
    const sourceDate = new Date(SOURCE_DATE)

    // Act
    const thread = buildThread({ sourceDate, history, notes, reply: null })

    // Assert
    expect(history.map((entry) => entry.id)).toEqual(['escalate:1', 'assign:1'])
    expect(history.map((entry) => entry.occurredAt.toISOString())).toEqual([
      '2026-08-26T16:00:00.000Z',
      '2026-08-26T12:00:00.000Z',
    ])
    expect(notes.map((note) => note.id)).toEqual(['note-1'])
    expect(sourceDate.toISOString()).toBe(SOURCE_DATE.toISOString())
    expect(thread.map(describeEntry)).toEqual([
      'guest',
      'event:assign:1',
      'note:note-1',
      'event:escalate:1',
    ])
    // The thread owns its Date objects, so a consumer cannot write back.
    expect(thread[0].at).not.toBe(sourceDate)
  })

  it('keeps ThreadEntry to the kinds the thread has a row for', () => {
    // Arrange — `ThreadRow` (inbox-thread.tsx) asserts `never` in `default:`,
    // so a new member fails the build there instead of falling through to the
    // guest message and rendering the review a second time. Same guard here.
    const rows: Record<ThreadEntry['kind'], true> = ROW_KINDS

    // Act / Assert
    expect(Object.keys(rows).sort()).toEqual(['event', 'guest', 'note', 'reply'])
  })

  it('sorts every reply state on the instant that state prints', () => {
    for (const [kind, view] of Object.entries(REPLY_CASES)) {
      // Arrange / Act — the model's field selection against the presenter's.
      const reply = 'reply' in view ? view.reply : null
      const printed = presentReplyMessage(view)?.meta?.at
      // No printed instant — a draft renders nothing in the thread and `none`
      // has no row — so the documented `updatedAt` fallback contradicts
      // nothing. Every other state prints a milestone `updatedAt` is not.
      const expected = printed ?? (reply === null ? null : UPDATED_AT)

      // Assert
      expect(sortKey(reply), `${kind} does not sort on what it prints`).toEqual(expected)
    }
  })

  it('does not move the reply when a publication attempt bumps updatedAt', () => {
    // Arrange — a publish-failed reply confirmed at 10:15, above the note and
    // event of the 27th; every attempt since, including the manager's `Try
    // publishing again`, has stamped `updatedAt` days later.
    const stream = {
      sourceDate: SOURCE_DATE,
      history: [makeEvent('escalate:1', '2026-08-27T12:00:00.000Z')],
      notes: [makeNote('note-1', '2026-08-27T09:00:00.000Z')],
    }

    // Act / Assert — the thread reads in the order the meta lines do, and the
    // retry does not slide the row out from under the pointer.
    for (const at of [UPDATED_AT, new Date('2026-08-29T08:00:00.000Z')]) {
      const thread = buildThread({ ...stream, reply: makeReply(at, FAILED) })
      expect(thread.map(describeEntry)).toEqual(REPLY_LEADS)
    }
  })
})
