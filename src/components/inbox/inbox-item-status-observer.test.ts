import { describe, expect, it } from 'vitest'
import { createInboxItemStatusObserver } from './inbox-item-status-observer'

describe('Inbox item status observer', () => {
  it('does not carry a status transition across selected item identities', () => {
    const observer = createInboxItemStatusObserver()

    expect(observer.observe({ itemId: 'item-a', status: 'open' })).toBe(false)
    expect(observer.observe({ itemId: 'item-b', status: 'closed' })).toBe(false)
    expect(observer.observe({ itemId: 'item-b', status: 'open' })).toBe(true)
  })

  it('accepts a locally handled status without reporting it again', () => {
    const observer = createInboxItemStatusObserver()
    observer.observe({ itemId: 'item-a', status: 'open' })

    observer.accept({ itemId: 'item-a', status: 'closed' })

    expect(observer.observe({ itemId: 'item-a', status: 'closed' })).toBe(false)
  })
})
