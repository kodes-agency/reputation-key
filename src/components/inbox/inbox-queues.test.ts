import { describe, expect, it } from 'vitest'
import type {
  InboxItem,
  InboxItemReplyState,
} from '#/contexts/inbox/application/public-api'
import {
  canUseReplyQueues,
  inboxEmptyCopy,
  isReplyStageQueue,
  itemMatchesQueue,
  queueItem,
  queueLabel,
  queueReplyStage,
} from './inbox-queues'

describe('canUseReplyQueues', () => {
  it('requires both role permission and the independent reply capability', () => {
    expect(canUseReplyQueues(true, true)).toBe(true)
    expect(canUseReplyQueues(true, false)).toBe(false)
    expect(canUseReplyQueues(false, true)).toBe(false)
  })
})

describe('queue names', () => {
  it('names the queues as the rail does', () => {
    expect(
      (
        [
          'reply',
          'approval',
          'waiting',
          'replied',
          'feedback',
          'handled',
          'mine',
          'escalated',
          'open',
        ] as const
      ).map((queue) => queueLabel(queue)),
    ).toEqual([
      'Needs reply',
      'Awaiting approval',
      'Waiting for Google',
      'Replied',
      'To handle',
      'Handled',
      'Mine',
      'Escalated',
      'All open',
    ])
  })

  it('reads the one reply row "Open" without reply stages, keeping its key and glyph', () => {
    const withStages = queueItem('reply')
    const without = queueItem('reply', false)

    expect(without.label).toBe('Open')
    expect(without.key).toBe(withStages.key)
    expect(without.icon).toBe(withStages.icon)
    expect(queueLabel('open', false)).toBe('All open')
  })

  it('draws every queue of the rail with its own glyph', () => {
    const queues = [
      'reply',
      'approval',
      'waiting',
      'replied',
      'feedback',
      'handled',
      'mine',
      'escalated',
      'open',
    ] as const
    const icons = queues.map((queue) => queueItem(queue).icon)
    expect(new Set(icons).size).toBe(icons.length)
  })
})

describe('empty states', () => {
  it('says what each closed folder is for', () => {
    expect(inboxEmptyCopy('replied', false)).toEqual({
      title: 'Nothing replied yet',
      description: 'Reviews move here once their reply is live on Google.',
    })
    expect(inboxEmptyCopy('handled', false)).toEqual({
      title: 'Nothing handled yet',
      description: 'Feedback you mark handled moves here.',
    })
  })

  it('explains where private feedback comes from', () => {
    const copy = inboxEmptyCopy('feedback', false)

    expect(copy.title).toBe('No feedback to handle')
    expect(copy.description).toMatch(/private note from your guest page/)
  })

  it('speaks of open reviews, not of replies, when the reply row is "Open"', () => {
    expect(inboxEmptyCopy('reply', false, false).title).toBe('No open reviews')
    expect(inboxEmptyCopy('reply', false).title).toBe('Nothing needs a reply')
  })

  it('says "No matches" for any queue once a filter or search narrows it', () => {
    expect(inboxEmptyCopy('replied', true).title).toBe('No matches')
    expect(inboxEmptyCopy('reply', true, false).title).toBe('No matches')
  })
})

describe('itemMatchesQueue', () => {
  const base = {
    id: 'item-1',
    status: 'open',
    sourceType: 'review',
    assignedTo: null,
    isEscalated: false,
    escalationResolvedAt: null,
  } as unknown as InboxItem
  const withReply = (replyState: InboxItemReplyState): InboxItem => ({
    ...base,
    replyState,
  })
  const closedReview = { ...base, status: 'closed' } as InboxItem
  const openFeedback = { ...base, sourceType: 'feedback' } as InboxItem
  const closedFeedback = { ...openFeedback, status: 'closed' } as InboxItem
  const uncertain = (reconcileDueAt: Date | null): InboxItemReplyState => ({
    status: 'publish_failed',
    publicationState: 'ambiguous',
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt,
    updatedAt: new Date('2026-09-14T12:00:00.000Z'),
  })

  it('lists an uncertain publish under Waiting for Google while checks continue', () => {
    const item = withReply(uncertain(new Date('2026-09-14T12:15:00.000Z')))

    expect(itemMatchesQueue(item, 'waiting', 'viewer')).toBe(true)
    expect(itemMatchesQueue(item, 'reply', 'viewer')).toBe(false)
    expect(itemMatchesQueue(item, 'approval', 'viewer')).toBe(false)
  })

  it('lists an uncertain publish under Needs reply once automatic checks stop', () => {
    const item = withReply(uncertain(null))

    expect(itemMatchesQueue(item, 'reply', 'viewer')).toBe(true)
    expect(itemMatchesQueue(item, 'waiting', 'viewer')).toBe(false)
  })

  it('holds every closed Review under Replied and every closed feedback under Handled', () => {
    expect(itemMatchesQueue(closedReview, 'replied', 'viewer')).toBe(true)
    expect(itemMatchesQueue(closedReview, 'handled', 'viewer')).toBe(false)
    expect(itemMatchesQueue(closedFeedback, 'handled', 'viewer')).toBe(true)
    expect(itemMatchesQueue(closedFeedback, 'replied', 'viewer')).toBe(false)
    expect(itemMatchesQueue(base, 'replied', 'viewer')).toBe(false)
    expect(itemMatchesQueue(openFeedback, 'handled', 'viewer')).toBe(false)
  })

  it('still lists every closed item under the retired closed key', () => {
    expect(itemMatchesQueue(closedReview, 'closed', 'viewer')).toBe(true)
    expect(itemMatchesQueue(closedFeedback, 'closed', 'viewer')).toBe(true)
    expect(itemMatchesQueue(base, 'closed', 'viewer')).toBe(false)
  })

  it('holds open feedback under To handle, apart from open Reviews', () => {
    expect(itemMatchesQueue(openFeedback, 'feedback', 'viewer')).toBe(true)
    expect(itemMatchesQueue(openFeedback, 'reply', 'viewer')).toBe(false)
    expect(itemMatchesQueue(base, 'feedback', 'viewer')).toBe(false)
  })

  it('reads reply as every open Review without reply stages, whatever its reply says', () => {
    const awaiting = withReply({
      status: 'pending_approval',
      publicationState: null,
      publicationLastErrorClass: null,
      updatedAt: new Date('2026-09-14T12:00:00.000Z'),
    })

    expect(itemMatchesQueue(awaiting, 'reply', 'viewer')).toBe(false)
    expect(itemMatchesQueue(awaiting, 'reply', 'viewer', false)).toBe(true)
    expect(itemMatchesQueue(base, 'reply', 'viewer', false)).toBe(true)
    expect(itemMatchesQueue(closedReview, 'reply', 'viewer', false)).toBe(false)
    expect(itemMatchesQueue(openFeedback, 'reply', 'viewer', false)).toBe(false)
  })
})

describe('reply stages', () => {
  it('names the queues whose membership a reply state decides', () => {
    expect(isReplyStageQueue('reply')).toBe(true)
    expect(isReplyStageQueue('approval')).toBe(true)
    expect(isReplyStageQueue('waiting')).toBe(true)
    expect(isReplyStageQueue('replied')).toBe(false)
    expect(isReplyStageQueue('mine')).toBe(false)
    expect(isReplyStageQueue('escalated')).toBe(false)
  })

  it('admits no stage to the reply queue once the stages are gone', () => {
    expect(queueReplyStage('reply')).toBe('needs_reply')
    expect(queueReplyStage('reply', false)).toBeNull()
    expect(queueReplyStage('approval')).toBe('awaiting')
    expect(queueReplyStage('waiting')).toBe('waiting')
    expect(queueReplyStage('feedback')).toBeNull()
  })
})
