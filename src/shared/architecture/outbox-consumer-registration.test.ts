// BQR-2.2: Durable outbox consumers must be wired on the worker path.
// Finding 1.3 — registerInboxConsumers had zero callers.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearConsumers,
  listRegisteredConsumers,
  registerConsumer,
} from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'
import type { ReviewLookupPort } from '#/contexts/inbox/application/ports/review-lookup.port'
import type { CreateInboxItem } from '#/contexts/inbox/application/use-cases/create-inbox-item'
import type { UpdateInboxStatus } from '#/contexts/inbox/application/use-cases/update-inbox-status'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

const ROOT = process.cwd()

describe('BQR-2.2: outbox consumer registration', () => {
  beforeEach(() => {
    clearConsumers()
  })

  it('worker wires registerOutboxConsumers when outbox is available', () => {
    const workerSrc = readFileSync(join(ROOT, 'src/worker/index.ts'), 'utf-8')
    expect(workerSrc).toContain('registerOutboxConsumers')
    expect(workerSrc).toContain('container.outboxRepo')
  })

  it('composition exposes registerOutboxConsumers that calls registerInboxConsumers', () => {
    const compositionSrc = readFileSync(join(ROOT, 'src/composition.ts'), 'utf-8')
    expect(compositionSrc).toContain('registerOutboxConsumers')
    expect(compositionSrc).toContain('registerInboxConsumers')
  })

  it('registerInboxConsumers registers the three review→inbox consumers', async () => {
    const { registerInboxConsumers } =
      await import('#/contexts/inbox/infrastructure/outbox-consumers')

    const outboxRepo = {
      insert: async () => {},
      claimUnpublished: async () => [],
      markPublished: async () => {},
      hasReceipt: async () => false,
      insertReceipt: async () => {},
      findExpiredLeases: async () => [],
      purgePublishedBefore: async () => 0,
      purgeReceiptsBefore: async () => 0,
    } satisfies OutboxRepository

    const reviewLookup = {
      getReviewSnippetById: async () => null,
    } as unknown as ReviewLookupPort

    const createInboxItem = (async () => {}) as unknown as CreateInboxItem
    const updateInboxStatus = (async () => {}) as unknown as UpdateInboxStatus

    registerInboxConsumers({
      outboxRepo,
      reviewLookup,
      createInboxItem,
      updateInboxStatus,
    })

    const registered = listRegisteredConsumers()
    expect(registered).toEqual(
      expect.arrayContaining([
        { eventType: 'review.created', consumerName: 'inbox.on-review-created' },
        { eventType: 'review.updated', consumerName: 'inbox.on-review-updated' },
        { eventType: 'review.expired', consumerName: 'inbox.on-review-expired' },
      ]),
    )
    expect(registered).toHaveLength(3)
  })

  it('listRegisteredConsumers is empty after clear', () => {
    registerConsumer({
      eventType: 'x.y',
      consumerName: 'c',
      handler: async () => ({ status: 'applied' }),
    })
    expect(listRegisteredConsumers()).toHaveLength(1)
    clearConsumers()
    expect(listRegisteredConsumers()).toEqual([])
  })
})
