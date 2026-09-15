import { describe, expect, it } from 'vitest'
import {
  REPLY_QUEUE_PUBLICATION_STATES,
  REPLY_QUEUE_STATUSES,
  isUncertainReplyStillChecked,
  replyQueueStage,
  type ReplyQueueStage,
} from './reply-queue-stage'

const DUE = new Date('2026-09-14T12:15:00.000Z')

// The expected stage is written out independently of the implementation so the
// matrix pins D8 rather than mirroring the code under test.
function expectedStage(
  status: string,
  publicationState: string | null,
  hasDueTime: boolean,
): ReplyQueueStage {
  if (status === 'pending_approval') return 'awaiting'
  if (status === 'approved' || status === 'published') return 'waiting'
  if (status === 'publish_failed' && publicationState === 'ambiguous' && hasDueTime) {
    return 'waiting'
  }
  return 'needs_reply'
}

describe('replyQueueStage', () => {
  const matrix = REPLY_QUEUE_STATUSES.flatMap((status) =>
    [null, ...REPLY_QUEUE_PUBLICATION_STATES].flatMap((publicationState) =>
      [true, false].map((hasDueTime) => ({ status, publicationState, hasDueTime })),
    ),
  )

  it('enumerates every persisted status and publication state', () => {
    expect(REPLY_QUEUE_STATUSES).toEqual([
      'draft',
      'pending_approval',
      'approved',
      'published',
      'rejected',
      'publish_failed',
    ])
    expect(REPLY_QUEUE_PUBLICATION_STATES).toEqual([
      'requested',
      'authorized',
      'sending',
      'pending_observation',
      'published',
      'terminal',
      'ambiguous',
      'cancelled',
    ])
    expect(matrix).toHaveLength(6 * 9 * 2)
  })

  it.each(matrix)(
    'places $status × $publicationState (due: $hasDueTime) in its queue',
    ({ status, publicationState, hasDueTime }) => {
      expect(
        replyQueueStage({
          status,
          publicationState,
          reconcileDueAt: hasDueTime ? DUE : null,
        }),
      ).toBe(expectedStage(status, publicationState, hasDueTime))
    },
  )

  it('keeps an uncertain publish waiting while automatic checks continue', () => {
    const uncertain = { status: 'publish_failed', publicationState: 'ambiguous' }

    expect(replyQueueStage({ ...uncertain, reconcileDueAt: DUE })).toBe('waiting')
    // A serialized cache snapshot carries the due time as an ISO string.
    expect(replyQueueStage({ ...uncertain, reconcileDueAt: DUE.toISOString() })).toBe(
      'waiting',
    )
    expect(replyQueueStage({ ...uncertain, reconcileDueAt: null })).toBe('needs_reply')
  })

  it('does not treat a never-sent or rejected publish as still being checked', () => {
    expect(
      isUncertainReplyStillChecked({
        status: 'publish_failed',
        publicationState: 'terminal',
        reconcileDueAt: DUE,
      }),
    ).toBe(false)
    expect(
      isUncertainReplyStillChecked({
        status: 'approved',
        publicationState: 'ambiguous',
        reconcileDueAt: DUE,
      }),
    ).toBe(false)
  })
})
