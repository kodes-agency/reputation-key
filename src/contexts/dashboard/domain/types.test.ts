// Dashboard context — domain types unit tests
import { describe, it, expect } from 'vitest'
import { toDashboardReplyStatus } from './types'

describe('toDashboardReplyStatus', () => {
  it('accepts valid statuses', () => {
    expect(toDashboardReplyStatus('none').isOk()).toBe(true)
    expect(toDashboardReplyStatus('none')._unsafeUnwrap()).toBe('none')
    expect(toDashboardReplyStatus('draft')._unsafeUnwrap()).toBe('draft')
    expect(toDashboardReplyStatus('published')._unsafeUnwrap()).toBe('published')
  })

  it('rejects unknown statuses', () => {
    const r = toDashboardReplyStatus('pending_approval')
    expect(r.isErr()).toBe(true)
    if (r.isErr()) {
      expect(r.error).toContain('Invalid DashboardReplyStatus')
    }
  })

  it('rejects empty string', () => {
    expect(toDashboardReplyStatus('').isErr()).toBe(true)
  })

  it('rejects unexpected SQL CASE results', () => {
    // If a new DB enum value arrives without explicit handling,
    // the validator catches it instead of silently accepting.
    expect(toDashboardReplyStatus('rejected').isErr()).toBe(true)
    expect(toDashboardReplyStatus('publish_failed').isErr()).toBe(true)
  })
})
