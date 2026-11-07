import { describe, expect, it } from 'vitest'
import { toggleAiCapability } from './merchant-ai-capability-selection'

describe('AI capability selection', () => {
  const order = ['review_analysis', 'reply_drafting'] as const

  it('toggles analysis and drafting independently in notice order', () => {
    expect(
      toggleAiCapability(['reply_drafting'], 'review_analysis', true, order),
    ).toEqual(order)
    expect(toggleAiCapability(order, 'review_analysis', false, order)).toEqual([
      'reply_drafting',
    ])
  })

  it('never carries a historical retired capability into a new choice', () => {
    expect(
      toggleAiCapability(
        ['review_analysis', 'property_trends'],
        'reply_drafting',
        true,
        order,
      ),
    ).toEqual(order)
    expect(toggleAiCapability([], 'property_trends', true, order)).toEqual([])
  })
})
