// ARC-03-T7 — the consumer registry is container-scoped.
//
// The duplicate check must stay exactly as strict WITHIN one registry (two
// consumers under one name would silently share a receipt key) while no
// longer leaking ACROSS registries — that leak is what stopped a second
// container in the same process from registering its consumers at all.

import { describe, it, expect } from 'vitest'
import { createConsumerRegistry, type ConsumerRegistration } from './consumer-registry'

const registration = (
  overrides: Partial<ConsumerRegistration> = {},
): ConsumerRegistration => ({
  eventType: 'review.created',
  consumerName: 'inbox.on-review-created',
  module: 'inbox.outbox-consumers',
  handler: async () => ({ status: 'applied' }),
  ...overrides,
})

describe('createConsumerRegistry', () => {
  it('lets two registries hold the same consumer independently', () => {
    const first = createConsumerRegistry()
    const second = createConsumerRegistry()

    first.registerConsumer(registration())
    expect(() => second.registerConsumer(registration())).not.toThrow()

    expect(first.list()).toEqual(second.list())
    expect(first.list()).not.toBe(second.list())
  })

  it('still rejects a duplicate within one registry', () => {
    const registry = createConsumerRegistry()
    registry.registerConsumer(registration())

    expect(() => registry.registerConsumer(registration())).toThrow(
      'Duplicate consumer "inbox.on-review-created" for event type "review.created"',
    )
  })

  it('accepts a second consumer name for the same event type', () => {
    const registry = createConsumerRegistry()
    registry.registerConsumer(registration())
    registry.registerConsumer(registration({ consumerName: 'metric.on-review-created' }))

    expect(registry.listFor('review.created').map((r) => r.consumerName)).toEqual([
      'inbox.on-review-created',
      'metric.on-review-created',
    ])
  })

  it('reads only its own instance from list() and listFor()', () => {
    const first = createConsumerRegistry()
    const second = createConsumerRegistry()

    first.registerConsumer(registration())
    second.registerConsumer(registration({ eventType: 'review.expired' }))

    expect(first.list()).toEqual([
      { eventType: 'review.created', consumerName: 'inbox.on-review-created' },
    ])
    expect(first.listFor('review.expired')).toEqual([])
    expect(second.listFor('review.created')).toEqual([])
    expect(second.listFor('review.expired')).toHaveLength(1)
  })

  it('clears only its own registrations', () => {
    const first = createConsumerRegistry()
    const second = createConsumerRegistry()
    first.registerConsumer(registration())
    second.registerConsumer(registration())

    first.clear()

    expect(first.list()).toEqual([])
    expect(second.list()).toHaveLength(1)
  })

  it('exposes a frozen capability surface', () => {
    expect(Object.isFrozen(createConsumerRegistry())).toBe(true)
  })
})
