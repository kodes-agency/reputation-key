import { describe, expect, it } from 'vitest'
import { reviewId, userId } from '#/shared/domain/ids'
import { INBOX_QUEUES, queueToFilters, type InboxQueue } from './inbox-queues'

const VIEWER = userId('user-1')
const AWAITING = reviewId('10000000-0000-4000-8000-000000000001')
const WAITING = reviewId('10000000-0000-4000-8000-000000000002')

const managerContext = {
  viewerId: VIEWER,
  canManageReplies: true,
  replyStages: { awaiting: [AWAITING], waiting: [WAITING] },
} as const

const withoutReplyStages = {
  viewerId: VIEWER,
  canManageReplies: false,
  replyStages: { awaiting: [], waiting: [] },
} as const

describe('queueToFilters', () => {
  it('defines the complete queue vocabulary', () => {
    expect(INBOX_QUEUES).toEqual([
      'reply',
      'approval',
      'waiting',
      'replied',
      'feedback',
      'handled',
      'escalated',
      'mine',
      'closed',
      'open',
    ])
  })

  it.each<readonly [InboxQueue, object]>([
    [
      'reply',
      {
        status: 'open',
        sourceType: 'review',
        replyStage: { match: 'exclude', reviewIds: [AWAITING, WAITING] },
      },
    ],
    [
      'approval',
      {
        status: 'open',
        sourceType: 'review',
        replyStage: { match: 'include', reviewIds: [AWAITING] },
      },
    ],
    [
      'waiting',
      {
        status: 'open',
        sourceType: 'review',
        replyStage: { match: 'include', reviewIds: [WAITING] },
      },
    ],
    // The closed folders hold every closed item of their kind, including the
    // rare close that is not a reply or a handling (ADR 0057, amended 2026-10-28).
    ['replied', { status: 'closed', sourceType: 'review' }],
    ['feedback', { status: 'open', sourceType: 'feedback' }],
    ['handled', { status: 'closed', sourceType: 'feedback' }],
    ['escalated', { isEscalated: true }],
    ['mine', { status: 'open', assignedTo: VIEWER }],
    ['closed', { status: 'closed' }],
    ['open', { status: 'open' }],
  ])('maps %s to its authoritative list predicates', (queue, expected) => {
    expect(queueToFilters(queue, managerContext)).toEqual(expected)
  })

  it('reads reply as every open Review when reply stages are unavailable', () => {
    // The rail's one reply row is then labelled "Open": no stage decides it.
    expect(queueToFilters('reply', withoutReplyStages)).toEqual({
      status: 'open',
      sourceType: 'review',
    })
  })

  it.each<InboxQueue>(['approval', 'waiting'])(
    'refuses %s without reply stages',
    (queue) => {
      expect(() => queueToFilters(queue, withoutReplyStages)).toThrowError(
        expect.objectContaining({ _tag: 'InboxError', code: 'forbidden' }),
      )
    },
  )

  it.each<InboxQueue>(['replied', 'handled', 'feedback', 'escalated', 'mine', 'open'])(
    'does not need reply stages to read %s',
    (queue) => {
      expect(() => queueToFilters(queue, withoutReplyStages)).not.toThrow()
    },
  )
})
