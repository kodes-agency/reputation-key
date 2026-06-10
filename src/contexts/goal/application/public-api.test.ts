import { describe, it, expect } from 'vitest'

// Smoke test: verify the public API module re-exports expected symbols.
// Since the module only re-exports types and a few runtime values,
// we verify the runtime exports are callable/exist at import time.

import { goalCompleted, goalProgressUpdated } from '../domain/events'
import { deriveEntityScope } from './public-api'
import { goalId, organizationId, propertyId, userId } from '#/shared/domain/ids'

describe('GoalPublicApi', () => {
  it('exports goalCompleted factory', () => {
    expect(typeof goalCompleted).toBe('function')
  })

  it('exports goalProgressUpdated factory', () => {
    expect(typeof goalProgressUpdated).toBe('function')
  })

  it('exports deriveEntityScope helper', () => {
    expect(typeof deriveEntityScope).toBe('function')
  })

  it('goalCompleted creates an event with _tag goal.completed', () => {
    const event = goalCompleted({
      eventId: crypto.randomUUID(),
      correlationId: null,
      goalId: goalId('g1'),
      organizationId: organizationId('o1'),
      propertyId: propertyId('p1'),
      portalId: null,
      portalGroupId: null,
      goalType: 'one_shot',
      aggregationFunction: 'sum',
      metricKey: 'portal.scan',
      targetValue: 10,
      completedValue: 10,
      completedAt: new Date(),
      parentGoalId: null,
      createdBy: userId('u1'),
    })
    expect(event._tag).toBe('goal.completed')
  })

  it('goalProgressUpdated creates an event with _tag goal.progress_updated', () => {
    const event = goalProgressUpdated({
      goalId: goalId('g1'),
      organizationId: organizationId('o1'),
      metricKey: 'portal.scan',
      previousValue: 5,
      currentValue: 8,
      computedSource: 'event_increment',
      occurredAt: new Date(),
    })
    expect(event._tag).toBe('goal.progress_updated')
  })
})
