import { describe, expect, it, vi } from 'vitest'
import { onFeedbackRetracted } from './on-feedback-retracted'
import type { GuestFeedbackRetracted } from '#/contexts/guest/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxItem } from '../../domain/types'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORG = organizationId('org-1')
const FEEDBACK = feedbackId('feedback-1')

const item: InboxItem = {
  id: inboxItemId('inbox-1'),
  organizationId: ORG,
  propertyId: propertyId('prop-1'),
  sourceType: 'feedback',
  sourceId: FEEDBACK,
  status: 'open',
  rating: null,
  sourceDate: NOW,
  platform: null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const event: GuestFeedbackRetracted = {
  _tag: 'guest.feedback.retracted',
  eventId: 'event-1',
  feedbackId: FEEDBACK,
  organizationId: ORG,
  portalId: portalId('portal-1'),
  propertyId: propertyId('prop-1'),
  supersedesSourceEventId: 'source-event-1',
  occurredAt: NOW,
  correlationId: null,
}

describe('onFeedbackRetracted', () => {
  it('closes an open feedback item after its text is purged', async () => {
    const applySourceWithdrawnOnce = vi.fn(async () => 'applied' as const)
    const deps = {
      repo: {
        findBySource: vi.fn(async () => item),
      } as unknown as InboxRepository,
      commandStore: { applySourceWithdrawnOnce, recordReceipt: vi.fn() },
      logger: createMockLogger(),
    }

    await onFeedbackRetracted(deps)(event)

    expect(deps.repo.findBySource).toHaveBeenCalledWith('feedback', 'feedback-1', ORG)
    expect(applySourceWithdrawnOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        consumerName: 'inbox.on-guest-feedback-retracted',
        item,
        sourceRevision: 1,
        now: NOW,
        fact: expect.objectContaining({
          _tag: 'inbox.inbox_item.status_changed',
          oldStatus: 'open',
          newStatus: 'closed',
        }),
      }),
    )
  })

  it('lets the locked Handling Cycle decide idempotency when compatibility status is closed', async () => {
    const closedItem = { ...item, status: 'closed' as const }
    const applySourceWithdrawnOnce = vi.fn(async () => 'applied' as const)
    const deps = {
      repo: {
        findBySource: vi.fn(async () => closedItem),
      } as unknown as InboxRepository,
      commandStore: { applySourceWithdrawnOnce, recordReceipt: vi.fn() },
      logger: createMockLogger(),
    }

    await expect(onFeedbackRetracted(deps)(event)).resolves.toBeUndefined()
    expect(applySourceWithdrawnOnce).toHaveBeenCalledWith(
      expect.objectContaining({ item: closedItem }),
    )
  })
})
