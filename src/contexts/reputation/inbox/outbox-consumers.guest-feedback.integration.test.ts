// Durable inbox consumers for private guest feedback apply projections via
// applyOnce: state change, outbox facts, and the receipt co-commit through the
// inbox command store.

import { describe, it, expect, vi } from 'vitest'
import {
  handleInboxGuestFeedbackRetracted,
  handleInboxGuestFeedbackSubmitted,
} from '#/contexts/reputation/inbox/guest-feedback-outbox-consumers.server'
import {
  FEEDBACK,
  NOW,
  ORG,
  PROP,
  PROP2,
  guestFeedbackEvent,
  makeDeps,
  makeFeedbackItem,
  useOutboxConsumersDatabase,
} from './outbox-consumers.test-fixtures'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

useOutboxConsumersDatabase()

const SUBMITTED_RECEIPT = 'inbox.on-guest-feedback-submitted'
const RETRACTED_RECEIPT = 'inbox.on-guest-feedback-retracted'

const submittedEvent = (extra: Record<string, unknown> = {}) =>
  guestFeedbackEvent('guest.feedback.submitted', {
    ratingId: 'rating-1',
    occurredAt: NOW.toISOString(),
    ...extra,
  })

const retractedEvent = () =>
  guestFeedbackEvent('guest.feedback.retracted', {
    supersedesSourceEventId: 'source-event-1',
    occurredAt: NOW.toISOString(),
  })

describe('handleInboxGuestFeedbackSubmitted (durable private feedback)', () => {
  it('creates a metadata-only feedback item and co-commits its receipt', async () => {
    const { guestDeps, repo, events, expectReceipt } = await makeDeps({ item: null })

    const result = await handleInboxGuestFeedbackSubmitted(guestDeps, submittedEvent())

    expect(result).toEqual({ status: 'applied' })
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).toHaveBeenCalledWith(
      FEEDBACK,
      ORG,
    )
    expect(await repo.items()).toHaveLength(1)
    expect(await repo.first()).toMatchObject({
      sourceType: 'feedback',
      sourceId: FEEDBACK,
      propertyId: PROP,
      sourceDate: NOW,
      platform: null,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    await expectReceipt(SUBMITTED_RECEIPT, 'applied')
  })

  it('records an obsolete receipt when feedback was withdrawn before delivery', async () => {
    const { guestDeps, repo, expectReceipt } = await makeDeps({
      item: null,
      feedback: null,
    })

    const result = await handleInboxGuestFeedbackSubmitted(
      guestDeps,
      submittedEvent({ ratingId: null }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(await repo.items()).toHaveLength(0)
    await expectReceipt(SUBMITTED_RECEIPT, 'obsolete')
  })

  it('does not create work when retention already removed the private text', async () => {
    const { guestDeps, repo, expectReceipt } = await makeDeps({
      item: null,
      feedback: { comment: null, ratingValue: 2 },
    })

    await expect(
      handleInboxGuestFeedbackSubmitted(guestDeps, submittedEvent()),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(await repo.items()).toHaveLength(0)
    await expectReceipt(SUBMITTED_RECEIPT, 'obsolete')
  })

  it('rejects cross-tenant envelope attribution before reading feedback', async () => {
    const { guestDeps } = await makeDeps({ item: null })
    const event = submittedEvent({ ratingId: null, organizationId: 'other-org' })

    await expect(handleInboxGuestFeedbackSubmitted(guestDeps, event)).rejects.toThrow(
      'attribution',
    )
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).not.toHaveBeenCalled()
  })
})

describe('handleInboxGuestFeedbackRetracted (durable private feedback)', () => {
  it('closes an open feedback item and co-commits the status fact and receipt', async () => {
    const { guestDeps, repo, events, expectReceipt } = await makeDeps({
      item: makeFeedbackItem(),
    })

    const result = await handleInboxGuestFeedbackRetracted(guestDeps, retractedEvent())

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.first()).toMatchObject({ status: 'closed', closedAt: NOW })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toMatchObject([
      { oldStatus: 'open', newStatus: 'closed' },
    ])
    await expectReceipt(RETRACTED_RECEIPT, 'applied')
  })

  it('records an applied no-op when the item was never projected', async () => {
    const { guestDeps, expectReceipt } = await makeDeps({ item: null })

    await expect(
      handleInboxGuestFeedbackRetracted(guestDeps, retractedEvent()),
    ).resolves.toEqual({ status: 'applied' })
    await expectReceipt(RETRACTED_RECEIPT, 'applied')
  })

  it('lets the cycle store decide closure when the compatibility row is already closed', async () => {
    const { guestDeps, repo } = await makeDeps({
      item: makeFeedbackItem({
        status: 'closed',
        closedAt: new Date('2026-06-14T12:00:00Z'),
      }),
    })
    const stored = await repo.first()
    const apply = vi
      .spyOn(guestDeps.commandStore, 'applySourceWithdrawnOnce')
      .mockResolvedValue('applied')

    await handleInboxGuestFeedbackRetracted(guestDeps, retractedEvent())

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        item: stored,
        fact: expect.objectContaining({ oldStatus: 'open', newStatus: 'closed' }),
      }),
    )
  })

  it('fails closed when the projected item belongs to a different Property', async () => {
    const { guestDeps, expectNoReceipts } = await makeDeps({
      item: makeFeedbackItem({ propertyId: PROP2 }),
    })

    await expect(
      handleInboxGuestFeedbackRetracted(guestDeps, retractedEvent()),
    ).rejects.toThrow('scope does not match')
    await expectNoReceipts()
  })
})
