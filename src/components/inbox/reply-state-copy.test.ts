import { describe, expect, it } from 'vitest'
import type { InboxItemReplyState } from '#/contexts/inbox/application/public-api'
import { replyStateRowLabel } from './reply-state-copy'

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
})
