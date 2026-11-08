import { describe, expect, it } from 'vitest'
import { createDraftRevisionFence, matchesExpectedReply } from './contracts'

const first = { id: 'reply-a', stateRevision: 1 }
const second = { id: 'reply-a', stateRevision: 2 }

describe('draft revision fence', () => {
  it('keeps a stale editor bound to its first write despite a background re-fetch', () => {
    const fence = createDraftRevisionFence('review-a')
    expect(fence.beforeWrite(first)).toEqual(first)
    expect(fence.beforeWrite(second)).toEqual(first)
    expect(matchesExpectedReply(second, fence.beforeWrite(second))).toBe(false)
  })

  it('advances only after its own successful save or template adoption', () => {
    const fence = createDraftRevisionFence('review-a')
    fence.beforeWrite(first)
    fence.didWrite(second)
    expect(fence.beforeWrite(first)).toEqual(second)
    fence.didWrite(first)
    expect(fence.beforeWrite(first)).toEqual(second)
  })

  it('binds an initially empty composer and does not adopt a reply another tab created', () => {
    const fence = createDraftRevisionFence('review-a')
    expect(fence.beforeWrite(undefined)).toBeUndefined()
    expect(fence.beforeWrite(null)).toBeNull()
    expect(fence.beforeWrite(first)).toBeNull()
    expect(matchesExpectedReply(first, fence.beforeWrite(first))).toBe(false)
    fence.didWrite(first)
    expect(fence.beforeWrite(null)).toEqual(first)
  })

  it('keeps a late save on its own review when the manager navigates', () => {
    const previous = createDraftRevisionFence('review-a')
    const current = createDraftRevisionFence('review-b')
    current.beforeWrite(null)
    previous.didWrite(second)
    expect(current.beforeWrite(null)).toBeNull()
    expect(previous.beforeWrite(first)).toEqual(second)
  })

  it('can start again after its own successful deletion', () => {
    const fence = createDraftRevisionFence('review-a')
    fence.beforeWrite(first)
    fence.didDelete()
    expect(fence.beforeWrite(first)).toBeNull()
  })

  it('starts editing from the rejected reply the manager now sees after a read-only refresh', () => {
    const fence = createDraftRevisionFence('review-a')
    fence.showReadOnly(first)
    fence.showReadOnly(second)
    expect(fence.beforeWrite(second)).toEqual(second)
    const reopened = { ...second, stateRevision: 3 }
    fence.didWrite(reopened)
    // Once the rejected reply is reopened as a draft, an external save must
    // not authorize replacing that editor's words.
    expect(fence.beforeWrite({ ...second, stateRevision: 4 })).toEqual(reopened)
  })

  it('does not regress a completed command to a stale read-only render or a loading gap', () => {
    const fence = createDraftRevisionFence('review-a')
    fence.showReadOnly(first)
    fence.didWrite(second)
    fence.showReadOnly(first)
    fence.showReadOnly(undefined)
    expect(fence.beforeWrite(first)).toEqual(second)
  })

  it('binds a retained internal draft when it becomes editable after a Google reply disappears', () => {
    const fence = createDraftRevisionFence('review-a')
    // An external Google reply can outrank and hide an internal draft. It
    // supplies no internal revision, and there is no editable composer yet.
    fence.showReadOnly(null)
    expect(fence.beforeWrite(first)).toEqual(first)
    // Now that the composer exists, later external changes remain conflicts.
    expect(fence.beforeWrite(second)).toEqual(first)
  })

  it('refuses deletion and recreation even when the replacement revision is the same', () => {
    expect(matchesExpectedReply(null, first)).toBe(false)
    expect(matchesExpectedReply({ ...first, id: 'reply-b' }, first)).toBe(false)
    expect(matchesExpectedReply(first, first)).toBe(true)
    expect(matchesExpectedReply(null, null)).toBe(true)
  })
})
