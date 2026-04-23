// Tests for the in-process event bus
import { describe, it, expect, vi } from 'vitest'
import { createEventBus } from './event-bus'
import type { DomainEvent } from './events'

// Minimal test event shapes — we don't import real events to avoid
// pulling in context code; we just need valid DomainEvent-shaped objects.
function makeTestEvent(tag: string, payload: Record<string, unknown> = {}): DomainEvent {
  return { _tag: tag, ...payload } as unknown as DomainEvent
}

describe('createEventBus', () => {
  describe('emit / on', () => {
    it('delivers events to handlers subscribed to the matching tag', async () => {
      const bus = createEventBus()
      const handler = vi.fn(async () => {})
      bus.on('organization.created', handler)

      const event = makeTestEvent('organization.created', {
        organizationId: 'org-1',
        occurredAt: new Date(),
      })
      await bus.emit(event)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(event)
    })

    it('delivers correctly typed events via Extract', async () => {
      const bus = createEventBus()
      const received: Array<unknown> = []

      bus.on('organization.created', async (event) => {
        received.push(event)
      })

      const event = makeTestEvent('organization.created', {
        organizationId: 'org-1',
        occurredAt: new Date(),
      })
      await bus.emit(event)

      expect(received).toHaveLength(1)
      // Verify the handler received the full event with _tag
      expect(received[0]).toEqual(event)
    })

    it('delivers to multiple handlers subscribed to the same tag', async () => {
      const bus = createEventBus()
      const handler1 = vi.fn(async () => {})
      const handler2 = vi.fn(async () => {})

      bus.on('organization.created', handler1)
      bus.on('organization.created', handler2)

      await bus.emit(makeTestEvent('organization.created'))

      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('does not deliver events to handlers subscribed to a different tag', async () => {
      const bus = createEventBus()
      const handler = vi.fn(async () => {})

      bus.on('member.invited', handler)
      await bus.emit(makeTestEvent('organization.created'))

      expect(handler).not.toHaveBeenCalled()
    })

    it('is a no-op when emitting with no registered handlers', async () => {
      const bus = createEventBus()
      // Should not throw or reject
      await expect(
        bus.emit(makeTestEvent('organization.created')),
      ).resolves.toBeUndefined()
    })
  })

  describe('error isolation', () => {
    it('a handler throwing does not prevent other handlers from running', async () => {
      const bus = createEventBus()
      const handler1 = vi.fn(async () => {
        throw new Error('boom')
      })
      const handler2 = vi.fn(async () => {})

      bus.on('organization.created', handler1)
      bus.on('organization.created', handler2)

      await bus.emit(makeTestEvent('organization.created'))

      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('a handler throwing does not propagate to the emitter', async () => {
      const bus = createEventBus()

      bus.on('organization.created', async () => {
        throw new Error('handler error')
      })

      // emit should resolve without throwing
      await expect(
        bus.emit(makeTestEvent('organization.created')),
      ).resolves.toBeUndefined()
    })
  })

  describe('clear', () => {
    it('removes all handlers so subsequent emits are no-ops', async () => {
      const bus = createEventBus()
      const handler = vi.fn(async () => {})

      bus.on('organization.created', handler)
      bus.clear()

      await bus.emit(makeTestEvent('organization.created'))

      expect(handler).not.toHaveBeenCalled()
    })

    it('allows re-registering handlers after clear', async () => {
      const bus = createEventBus()
      const handler = vi.fn(async () => {})

      bus.on('organization.created', handler)
      bus.clear()
      bus.on('organization.created', handler)

      await bus.emit(makeTestEvent('organization.created'))

      expect(handler).toHaveBeenCalledOnce()
    })
  })
})
