import { describe, expect, it } from 'vitest'
import { canUseReplyQueues, resolveInboxQueue } from './inbox-queues'

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
