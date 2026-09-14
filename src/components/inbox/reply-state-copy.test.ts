import { describe, expect, it } from 'vitest'
import {
  replyStageForStatus,
  type InboxItemReplyState,
} from '#/contexts/inbox/application/public-api'
import {
  REPLY_CHIP_WORDS,
  replyStateRowLabel,
  resolveReplyStateCopy,
} from './reply-state-copy'

const replyState = (status: InboxItemReplyState['status']): InboxItemReplyState => ({
  status,
  publicationState: status === 'published' ? 'published' : null,
  publicationLastErrorClass: null,
  updatedAt: new Date('2026-04-15T12:00:00Z'),
})

describe('replyStateRowLabel', () => {
  it('keeps private drafts and about-to-close published replies off inbox rows', () => {
    expect(replyStateRowLabel(replyState('draft'))).toBeNull()
    expect(replyStateRowLabel(replyState('published'))).toBeNull()
  })

  const statuses: ReadonlyArray<InboxItemReplyState['status']> = [
    'draft',
    'pending_approval',
    'approved',
    'published',
    'rejected',
    'publish_failed',
  ]
  const publicationStates: ReadonlyArray<InboxItemReplyState['publicationState']> = [
    null,
    'requested',
    'authorized',
    'sending',
    'pending_observation',
    'published',
    'terminal',
    'ambiguous',
    'cancelled',
  ]

  it.each(
    statuses.flatMap((status) =>
      publicationStates.map((publicationState) => ({ status, publicationState })),
    ),
  )('keeps queue stage and row copy aligned for $status × $publicationState', (row) => {
    const copy = resolveReplyStateCopy({
      ...replyState(row.status),
      publicationState: row.publicationState,
    })
    const stage = replyStageForStatus(row.status)

    if (stage === 'awaiting') {
      expect(copy.badge).toBe(REPLY_CHIP_WORDS.awaitingApproval)
    } else if (stage === 'waiting') {
      expect([
        REPLY_CHIP_WORDS.waitingForGoogle,
        REPLY_CHIP_WORDS.liveOnGoogle,
      ]).toContain(copy.badge)
    } else {
      expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.awaitingApproval)
      expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.waitingForGoogle)
      expect(copy.badge).not.toBe(REPLY_CHIP_WORDS.liveOnGoogle)
    }
  })
})
