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

describe('queueToFilters', () => {
  it('defines the complete queue vocabulary', () => {
    expect(INBOX_QUEUES).toEqual([
      'reply',
      'approval',
      'waiting',
      'feedback',
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
    ['feedback', { status: 'open', sourceType: 'feedback' }],
    ['escalated', { isEscalated: true }],
    ['mine', { status: 'open', assignedTo: VIEWER }],
    ['closed', { status: 'closed' }],
    ['open', { status: 'open' }],
  ])('maps %s to its authoritative list predicates', (queue, expected) => {
    expect(queueToFilters(queue, managerContext)).toEqual(expected)
  })

  it.each<InboxQueue>(['reply', 'approval', 'waiting'])(
    'refuses %s without reply.manage',
    (queue) => {
      expect(() =>
        queueToFilters(queue, {
          viewerId: VIEWER,
          canManageReplies: false,
          replyStages: { awaiting: [], waiting: [] },
        }),
      ).toThrowError(expect.objectContaining({ _tag: 'InboxError', code: 'forbidden' }))
    },
  )
})
