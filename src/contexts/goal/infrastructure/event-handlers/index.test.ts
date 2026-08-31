import { describe, expect, it, vi } from 'vitest'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoalRepository } from '../../application/ports/goal.repository'
import { legacyGoalEventHandlersAreDisabled } from './index'

describe('registerGoalEventHandlers', () => {
  it('keeps every legacy Goal mutation consumer out of beta composition', () => {
    const registered: string[] = []
    const eventBus: EventBus = {
      on(tag) {
        registered.push(tag)
      },
      emit: async () => undefined,
      clear: () => undefined,
    }

    expect(
      legacyGoalEventHandlersAreDisabled({
        goalRepo: {} as GoalRepository,
        systemCancelGoalFn: vi.fn(),
        eventBus,
        clock: () => new Date('2026-08-27T00:00:00.000Z'),
        logger: { error: vi.fn() },
      }),
    ).toBe(true)

    expect(registered).toEqual([])
  })
})
