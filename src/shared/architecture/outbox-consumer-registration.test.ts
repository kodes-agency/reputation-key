// BQR-2.2: Durable outbox consumers must be wired on the worker path.
// Finding 1.3 — registerInboxConsumers had zero callers.
// Static-source checks only (no cross-zone imports into contexts/).

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearConsumers,
  listRegisteredConsumers,
  registerConsumer,
} from '#/shared/outbox/dispatcher'

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

  it('inbox outbox-consumers registers the three review→inbox consumers', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/outbox-consumers.ts'),
      'utf-8',
    )
    expect(src).toContain("eventType: 'review.created'")
    expect(src).toContain("consumerName: 'inbox.on-review-created'")
    expect(src).toContain("eventType: 'review.updated'")
    expect(src).toContain("consumerName: 'inbox.on-review-updated'")
    expect(src).toContain("eventType: 'review.expired'")
    expect(src).toContain("consumerName: 'inbox.on-review-expired'")
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

  it('BQR-2.4: updated/expired consumers perform real projection work', () => {
    const src = readFileSync(
      join(ROOT, 'src/contexts/inbox/infrastructure/outbox-consumers.ts'),
      'utf-8',
    )
    expect(src).toContain('syncDenormalizedFields')
    expect(src).toContain('updateStatus')
    expect(src).toContain('handleInboxReviewUpdated')
    expect(src).toContain('handleInboxReviewExpired')
    expect(src).not.toMatch(/TODO: Implement inbox item update/)
    expect(src).not.toMatch(/for now, mark as applied/i)
  })
})
