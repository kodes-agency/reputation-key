import { describe, expect, it } from 'vitest'
import type { InboxQueueCounts } from '#/contexts/inbox/application/public-api'
import { resolveReplyStages } from './inbox-queues'
import {
  defaultInboxQueue,
  otherKindShortcut,
  railSections,
  resolveInboxQueue,
  type InboxQueueViewer,
} from './inbox-queue-sections'

const MANAGER: InboxQueueViewer = {
  canManageReplies: true,
  canReadReviews: true,
  canReadFeedback: true,
}
const WITHOUT_STAGES: InboxQueueViewer = { ...MANAGER, canManageReplies: false }

const COUNTS: InboxQueueCounts = {
  reply: 12,
  approval: 3,
  waiting: 0,
  feedback: 5,
  escalated: 2,
  mine: 4,
  open: 24,
  replied: null,
  handled: null,
  closed: null,
  replyStages: true,
}

const outline = (viewer: InboxQueueViewer) =>
  railSections(viewer).map((section) => [
    section.heading,
    section.queues.map((queue) => queue.label),
  ])

describe('railSections', () => {
  it('draws Reviews, Private feedback, then the shared views with no heading', () => {
    expect(outline(MANAGER)).toEqual([
      ['Reviews', ['Needs reply', 'Awaiting approval', 'Waiting for Google', 'Replied']],
      ['Private feedback', ['To handle', 'Handled']],
      [null, ['Mine', 'Escalated', 'All open']],
    ])
  })

  it('keeps the queue keys of every row', () => {
    expect(railSections(MANAGER).flatMap((s) => s.queues.map((q) => q.key))).toEqual([
      'reply',
      'approval',
      'waiting',
      'replied',
      'feedback',
      'handled',
      'mine',
      'escalated',
      'open',
    ])
  })

  it('never lists the retired closed key', () => {
    for (const viewer of [MANAGER, WITHOUT_STAGES]) {
      const keys = railSections(viewer).flatMap((s) => s.queues.map((q) => q.key))
      expect(keys).not.toContain('closed')
    }
  })

  it('collapses the stages into one "Open" row keyed reply without reply stages', () => {
    expect(outline(WITHOUT_STAGES)).toEqual([
      ['Reviews', ['Open', 'Replied']],
      ['Private feedback', ['To handle', 'Handled']],
      [null, ['Mine', 'Escalated', 'All open']],
    ])
    expect(railSections(WITHOUT_STAGES)[0]?.queues[0]?.key).toBe('reply')
  })

  it('shows a section only for a kind the viewer can read, and All open only with both', () => {
    expect(outline({ ...MANAGER, canReadFeedback: false })).toEqual([
      ['Reviews', ['Needs reply', 'Awaiting approval', 'Waiting for Google', 'Replied']],
      [null, ['Mine', 'Escalated']],
    ])
    expect(outline({ ...MANAGER, canReadReviews: false })).toEqual([
      ['Private feedback', ['To handle', 'Handled']],
      [null, ['Mine', 'Escalated']],
    ])
  })

  it('shows the Private feedback section even when it holds nothing yet', () => {
    // Counts play no part: the section is a promise of where feedback arrives.
    expect(railSections(MANAGER).map((section) => section.id)).toContain('feedback')
  })
})

describe('where a viewer lands', () => {
  it('starts on the first row: Needs reply, or "Open" without stages', () => {
    expect(defaultInboxQueue(MANAGER)).toBe('reply')
    expect(defaultInboxQueue(WITHOUT_STAGES)).toBe('reply')
  })

  it('starts on To handle for a viewer who reads feedback only', () => {
    expect(defaultInboxQueue({ ...MANAGER, canReadReviews: false })).toBe('feedback')
  })

  it('keeps a queue the rail lists, and replaces one it does not', () => {
    expect(resolveInboxQueue('approval', MANAGER)).toBe('approval')
    expect(resolveInboxQueue('handled', MANAGER)).toBe('handled')
    expect(resolveInboxQueue(undefined, MANAGER)).toBe('reply')
    // The stages are unavailable, so their rows and addresses fall back to the one row.
    expect(resolveInboxQueue('approval', WITHOUT_STAGES)).toBe('reply')
    expect(resolveInboxQueue('waiting', WITHOUT_STAGES)).toBe('reply')
    expect(resolveInboxQueue('reply', WITHOUT_STAGES)).toBe('reply')
    expect(resolveInboxQueue('feedback', { ...MANAGER, canReadFeedback: false })).toBe(
      'reply',
    )
  })

  it('reads the retired closed key as Replied', () => {
    expect(resolveInboxQueue('closed', MANAGER)).toBe('replied')
  })
})

describe('otherKindShortcut', () => {
  const shortcut = (queue: Parameters<typeof otherKindShortcut>[0], viewer = MANAGER) =>
    otherKindShortcut(queue, viewer, COUNTS)

  it('offers To handle from every Reviews queue', () => {
    for (const queue of ['reply', 'approval', 'waiting', 'replied'] as const) {
      const chip = shortcut(queue)
      expect(chip?.item.key).toBe('feedback')
      expect(chip?.item.label).toBe('To handle')
      expect(chip?.count).toBe(5)
    }
  })

  it('offers Needs reply from a feedback queue, and "Open" without reply stages', () => {
    expect(shortcut('feedback')?.item.label).toBe('Needs reply')
    expect(shortcut('handled')?.count).toBe(12)
    expect(shortcut('feedback', WITHOUT_STAGES)?.item.label).toBe('Open')
    expect(shortcut('feedback', WITHOUT_STAGES)?.item.key).toBe('reply')
  })

  it('offers nothing from Mine, Escalated or All open', () => {
    for (const queue of ['mine', 'escalated', 'open'] as const) {
      expect(shortcut(queue)).toBeNull()
    }
  })

  it('offers nothing while the other queue is empty or its count has not arrived', () => {
    expect(otherKindShortcut('reply', MANAGER, { ...COUNTS, feedback: 0 })).toBeNull()
    expect(otherKindShortcut('reply', MANAGER, undefined)).toBeNull()
  })

  it('offers nothing towards a section the viewer cannot see', () => {
    expect(shortcut('reply', { ...MANAGER, canReadFeedback: false })).toBeNull()
    expect(shortcut('feedback', { ...MANAGER, canReadReviews: false })).toBeNull()
  })
})

// The page draws its rail from the server's answer to "are there reply stages
// here?", which the counts carry, and from the browser's own permissions and
// capability set only until that answer arrives. The two can disagree: the
// capability set fails to load (the browser guesses none), or an operator turns
// reply publication off after the page loaded (the browser guesses some).
describe('a rail drawn from the server, not the browser', () => {
  const viewerFor = (counts: InboxQueueCounts | undefined, browserGuess: boolean) => ({
    ...MANAGER,
    canManageReplies: resolveReplyStages(counts, browserGuess),
  })
  const SERVER_HAS_STAGES = COUNTS
  const SERVER_HAS_NONE: InboxQueueCounts = {
    ...COUNTS,
    reply: 24,
    approval: null,
    waiting: null,
    replyStages: false,
  }

  it('lists the stages the server has although the capability set failed to load', () => {
    const viewer = viewerFor(SERVER_HAS_STAGES, false)

    expect(outline(viewer)[0]).toEqual([
      'Reviews',
      ['Needs reply', 'Awaiting approval', 'Waiting for Google', 'Replied'],
    ])
    expect(resolveInboxQueue('approval', viewer)).toBe('approval')
  })

  it('collapses to "Open" when the server has no stages although the browser guessed some', () => {
    const viewer = viewerFor(SERVER_HAS_NONE, true)

    expect(outline(viewer)[0]).toEqual(['Reviews', ['Open', 'Replied']])
    expect(resolveInboxQueue('approval', viewer)).toBe('reply')
    // The phone's chip back to the Reviews reads as the row does.
    expect(otherKindShortcut('feedback', viewer, SERVER_HAS_NONE)?.item.label).toBe(
      'Open',
    )
  })

  it('draws what the browser guessed, until the counts answer', () => {
    expect(outline(viewerFor(undefined, true))[0]).toEqual([
      'Reviews',
      ['Needs reply', 'Awaiting approval', 'Waiting for Google', 'Replied'],
    ])
    expect(outline(viewerFor(undefined, false))[0]).toEqual([
      'Reviews',
      ['Open', 'Replied'],
    ])
  })
})
