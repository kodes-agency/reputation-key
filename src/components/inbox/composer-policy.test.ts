import { describe, expect, it } from 'vitest'
import {
  hasPendingComposerWork,
  liveEditTarget,
  offeredModes,
  type ComposerPendingWorkInput,
} from './composer-policy'
import type { ResolvedReplyView } from './reply-message-view'

type Reply = Extract<ResolvedReplyView, { kind: 'pending' }>['reply']

const AT = new Date('2026-09-12T09:00:00.000Z')

const BASE: Reply = {
  id: 'reply-1' as Reply['id'],
  reviewId: 'review-1' as Reply['reviewId'],
  organizationId: 'org-1' as Reply['organizationId'],
  text: 'Thank you for staying with us.',
  replyLanguageTag: 'en',
  templateId: null,
  templateVersion: null,
  status: 'draft',
  source: 'internal',
  createdBy: 'user-1' as Reply['createdBy'],
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 1,
  submittedAt: null,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: AT,
  updatedAt: AT,
}

const draft = (text: string): ResolvedReplyView => ({
  kind: 'compose',
  reply: { ...BASE, text },
})

const NO_WORK: ComposerPendingWorkInput = {
  itemId: 'item-1',
  replyView: { kind: 'compose', reply: null },
  noteDraft: { itemId: 'item-1', text: '' },
  reopen: 'idle',
}

describe('offeredModes', () => {
  it('orders reply before note and drops the surface each permission gates', () => {
    expect(offeredModes(true, true)).toEqual(['reply', 'note'])
    expect(offeredModes(true, false)).toEqual(['reply'])
    expect(offeredModes(false, true)).toEqual(['note'])
  })

  it('offers no composer at all to a caller who can neither reply nor note', () => {
    expect(offeredModes(false, false)).toEqual([])
  })
})

describe('liveEditTarget', () => {
  it('keeps the published editor open only while the reply is still published', () => {
    expect(liveEditTarget('published', 'published')).toBe('published')
  })

  it('closes the editor once republishing has moved the reply on', () => {
    expect(liveEditTarget('approved', 'published')).toBeNull()
    expect(liveEditTarget('pending', 'published')).toBeNull()
  })

  it('refuses a published target on a retry-failed reply, which cannot be saved', () => {
    expect(liveEditTarget('failed-retry', 'published')).toBeNull()
  })

  it('raises nothing when no editor was asked for', () => {
    expect(liveEditTarget('published', null)).toBeNull()
  })
})

describe('hasPendingComposerWork', () => {
  it('lets an untouched item open with the composer collapsed', () => {
    expect(hasPendingComposerWork(NO_WORK)).toBe(false)
  })

  it('keeps the composer open over a saved draft reply', () => {
    expect(
      hasPendingComposerWork({ ...NO_WORK, replyView: draft('Half a sentence') }),
    ).toBe(true)
  })

  it('keeps the composer open over a note typed about this item', () => {
    expect(
      hasPendingComposerWork({
        ...NO_WORK,
        noteDraft: { itemId: 'item-1', text: 'Chase the housekeeping lead' },
      }),
    ).toBe(true)
  })

  it('keeps the composer open while Edit & resubmit is in flight', () => {
    expect(hasPendingComposerWork({ ...NO_WORK, reopen: 'pending' })).toBe(true)
  })

  it('treats a whitespace-only draft or note as an empty box', () => {
    expect(hasPendingComposerWork({ ...NO_WORK, replyView: draft('   \n ') })).toBe(false)
    expect(
      hasPendingComposerWork({
        ...NO_WORK,
        noteDraft: { itemId: 'item-1', text: '  ' },
      }),
    ).toBe(false)
  })

  it('ignores a note draft belonging to the item the manager has moved on from', () => {
    expect(
      hasPendingComposerWork({
        ...NO_WORK,
        noteDraft: { itemId: 'item-2', text: 'About a different review' },
      }),
    ).toBe(false)
  })

  it('ignores a reply that is no longer the composer’s to edit', () => {
    // Anything past `compose` reads as a message in the thread (row 6), so its
    // text is on screen above the composer and a bar hides nothing.
    expect(
      hasPendingComposerWork({
        ...NO_WORK,
        replyView: { kind: 'pending', reply: { ...BASE, status: 'pending_approval' } },
      }),
    ).toBe(false)
  })

  it('does not treat a failed reopen as work — that path leaves the box empty', () => {
    expect(hasPendingComposerWork({ ...NO_WORK, reopen: 'failed' })).toBe(false)
  })
})
