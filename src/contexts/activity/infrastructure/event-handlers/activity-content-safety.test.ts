// BQC-4.3 — activity_log content safety (ADR 0045/0030/0048).
//
// The activity log is user-facing audit, not a content store: rows carry
// identifiers, subject refs, and status transitions only. Review text, reply
// text, reviewer identity, and note text must NEVER flow into an
// insert-activity-log payload — even when the triggering domain event still
// carries them on the in-process bus (the outbox denylist strips them for
// durability; these consumers must not reintroduce them).
//
// Method: invoke every review/reply/note-related handler with an event whose
// content fields are planted with marker strings, then assert the enqueued
// payload contains none of them. The reply-rejection `detail` (staff-authored
// moderation reason) is documented in the data-flow map as the one free-text
// field — it is tenant-authored, never provider content.

import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import {
  organizationId,
  propertyId,
  inboxItemId,
  inboxNoteId,
  userId,
  reviewId,
  replyId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')
const INBOX_ITEM = inboxItemId('00000000-0000-4000-8000-000000000010')
const NOTE = inboxNoteId('00000000-0000-4000-8000-000000000011')
const USER = userId('00000000-0000-4000-8000-000000000020')
const REVIEW = reviewId('00000000-0000-4000-8000-000000000030')
const REPLY = replyId('00000000-0000-4000-8000-000000000040')

const MARKERS = ['SECRET_REVIEW_TEXT', 'SECRET_REPLY_TEXT', 'SECRET_REVIEWER_NAME']

/** Content fields planted on the bus event — the handlers must ignore them. */
const CONTENT_MARKERS: Record<string, string> = {
  text: 'SECRET_REVIEW_TEXT',
  reviewText: 'SECRET_REVIEW_TEXT',
  comment: 'SECRET_REVIEW_TEXT',
  replyText: 'SECRET_REPLY_TEXT',
  noteText: 'SECRET_REPLY_TEXT',
  reviewerName: 'SECRET_REVIEWER_NAME',
  reviewerProfilePhotoUrl: 'https://example.test/SECRET_REVIEWER_NAME',
  snippet: 'SECRET_REVIEW_TEXT',
}

function createMockDeps() {
  const calls: { name: string; data: unknown }[] = []
  const queue = {
    add: vi.fn(async (name: string, data: unknown) => {
      calls.push({ name, data })
    }),
  } as unknown as Queue
  const inboxItemLookup = {
    findBySourceId: vi.fn(async (): Promise<string | null> => INBOX_ITEM as string),
  }
  return { queue, calls, inboxItemLookup }
}

function expectNoMarkerContent(calls: { name: string; data: unknown }[]) {
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) {
    expect(call.name).toBe('insert-activity-log')
    const serialized = JSON.stringify(call.data)
    for (const marker of MARKERS) {
      expect(serialized).not.toContain(marker)
    }
  }
}

describe('activity handlers — content safety (BQC-4.3)', () => {
  it('onReplySubmitted drops review/reply content from the activity payload', async () => {
    const { onReplySubmitted } = await import('./on-reply-submitted')
    const { queue, calls, inboxItemLookup } = createMockDeps()

    await onReplySubmitted({ queue, inboxItemLookup })({
      _tag: 'review.reply.submitted',
      eventId: 'evt-cs-1',
      replyId: REPLY,
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROP,
      userId: USER,
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })

  it('onReplyApproved drops review/reply content from the activity payload', async () => {
    const { onReplyApproved } = await import('./on-reply-approved')
    const { queue, calls, inboxItemLookup } = createMockDeps()

    await onReplyApproved({ queue, inboxItemLookup })({
      _tag: 'review.reply.approved',
      eventId: 'evt-cs-2',
      replyId: REPLY,
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROP,
      userId: USER,
      authorId: USER,
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })

  it('onReplyRejected keeps only the staff-authored reason — never review/reply content', async () => {
    const { onReplyRejected } = await import('./on-reply-rejected')
    const { queue, calls, inboxItemLookup } = createMockDeps()

    await onReplyRejected({ queue, inboxItemLookup })({
      _tag: 'review.reply.rejected',
      eventId: 'evt-cs-3',
      replyId: REPLY,
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROP,
      userId: USER,
      authorId: USER,
      // Staff-authored moderation reason (documented free-text field) — its
      // own value passes through; the planted provider content must not.
      reason: 'tone does not fit brand voice',
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
    const data = calls[0]!.data as { payload: { detail: string | null } }
    expect(data.payload.detail).toBe('tone does not fit brand voice')
  })

  it('onReplyPublished drops review/reply content from the activity payload', async () => {
    const { onReplyPublished } = await import('./on-reply-published')
    const { queue, calls, inboxItemLookup } = createMockDeps()

    await onReplyPublished({ queue, inboxItemLookup })({
      _tag: 'review.reply.published',
      eventId: 'evt-cs-4',
      replyId: REPLY,
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROP,
      userId: USER,
      authorId: USER,
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })

  it('onReplyPublicationCancelled carries only the enum cause', async () => {
    const { onReplyPublicationCancelled } =
      await import('./on-reply-publication-cancelled')
    const { queue, calls, inboxItemLookup } = createMockDeps()

    await onReplyPublicationCancelled({ queue, inboxItemLookup })({
      _tag: 'review.reply.publication_cancelled',
      eventId: 'evt-cs-5',
      replyId: REPLY,
      reviewId: REVIEW,
      organizationId: ORG,
      propertyId: PROP,
      cause: 'disconnect',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })

  it('onInboxNoteAdded drops note text from the activity payload', async () => {
    const { onInboxNoteAdded } = await import('./on-inbox-note-added')
    const { queue, calls } = createMockDeps()

    await onInboxNoteAdded({ queue })({
      _tag: 'inbox.inbox_note.added',
      eventId: 'evt-cs-6',
      inboxItemId: INBOX_ITEM,
      noteId: NOTE,
      organizationId: ORG,
      propertyId: PROP,
      userId: USER,
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })

  it('onInboxItemCreated carries only the source type — never review content', async () => {
    const { onInboxItemCreated } = await import('./on-inbox-item-created')
    const { queue, calls } = createMockDeps()

    await onInboxItemCreated({ queue })({
      _tag: 'inbox.inbox_item.created',
      eventId: 'evt-cs-7',
      inboxItemId: INBOX_ITEM,
      organizationId: ORG,
      propertyId: PROP,
      sourceType: 'review',
      sourceId: REVIEW,
      userId: USER,
      source: 'web',
      occurredAt: new Date(),
      correlationId: null,
      ...CONTENT_MARKERS,
    })

    expectNoMarkerContent(calls)
  })
})
