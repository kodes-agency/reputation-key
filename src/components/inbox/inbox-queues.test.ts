import { describe, expect, it } from 'vitest'
import type {
  InboxItem,
  InboxItemReplyState,
} from '#/contexts/inbox/application/public-api'
import {
  canUseReplyQueues,
  isReplyStageQueue,
  itemMatchesQueue,
  resolveInboxQueue,
} from './inbox-queues'

describe('canUseReplyQueues', () => {
  it('requires both role permission and the independent reply capability', () => {
    expect(canUseReplyQueues(true, true)).toBe(true)
    expect(canUseReplyQueues(true, false)).toBe(false)
    expect(canUseReplyQueues(false, true)).toBe(false)
  })
})

describe('resolveInboxQueue', () => {
  it('falls back from reply queues when reply publishing is unavailable', () => {
    expect(resolveInboxQueue(undefined, false)).toBe('open')
    expect(resolveInboxQueue('reply', false)).toBe('open')
    expect(resolveInboxQueue('approval', false)).toBe('open')
    expect(resolveInboxQueue('waiting', false)).toBe('open')
  })

  it('preserves non-reply queues and reply-capable defaults', () => {
    expect(resolveInboxQueue('feedback', false)).toBe('feedback')
    expect(resolveInboxQueue(undefined, true)).toBe('reply')
    expect(resolveInboxQueue('approval', true)).toBe('approval')
  })
})

describe('itemMatchesQueue reply stages', () => {
  const openReview = {
    id: 'item-1',
    status: 'open',
    sourceType: 'review',
    assignedTo: null,
    isEscalated: false,
    escalationResolvedAt: null,
  } as unknown as InboxItem
  const withReply = (replyState: InboxItemReplyState): InboxItem => ({
    ...openReview,
    replyState,
  })
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

  it('names the queues whose membership a reply state decides', () => {
    expect(isReplyStageQueue('reply')).toBe(true)
    expect(isReplyStageQueue('approval')).toBe(true)
    expect(isReplyStageQueue('waiting')).toBe(true)
    expect(isReplyStageQueue('mine')).toBe(false)
    expect(isReplyStageQueue('escalated')).toBe(false)
  })
})
