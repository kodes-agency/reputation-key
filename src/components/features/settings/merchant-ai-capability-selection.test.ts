import { describe, expect, it } from 'vitest'
import { toggleAiCapability } from './merchant-ai-capability-selection'

describe('AI capability selection', () => {
  const order = ['review_analysis', 'reply_drafting', 'property_trends'] as const

  it('adds review analysis with trends and drops trends with review analysis', () => {
    expect(toggleAiCapability([], 'property_trends', true, order)).toEqual([
      'review_analysis',
      'property_trends',
    ])
    expect(toggleAiCapability(order, 'review_analysis', false, order)).toEqual([
      'reply_drafting',
    ])
  })
})
