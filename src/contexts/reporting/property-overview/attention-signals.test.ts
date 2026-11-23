import { describe, expect, it } from 'vitest'
import { attentionSignalsFrom } from './attention-signals.server'

const noCounts = {
  overdue: 0,
  itemsToTriage: 0,
  escalated: 0,
  goalsBehindPace: 0,
  attentionWork: 0,
}

describe('attentionSignalsFrom', () => {
  it('does not infer a rating drop when there is no comparison period', () => {
    const result = attentionSignalsFrom(noCounts, {
      currentAverage: 4,
      currentCount: 10,
      priorAverage: null,
      priorCount: 0,
    })

    expect(result.ratingDrop).toBe(false)
    expect(result.needsAttention).toBe(0)
  })

  it('adds the rating-drop signal to the distinct work-anchor union', () => {
    expect(
      attentionSignalsFrom(
        {
          overdue: 3,
          itemsToTriage: 4,
          escalated: 2,
          goalsBehindPace: 1,
          attentionWork: 5,
        },
        { currentAverage: 4, currentCount: 10, priorAverage: 4.4, priorCount: 12 },
      ),
    ).toEqual({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
  })

  it('withholds rating-drop attention below the ten-review comparison floor', () => {
    const result = attentionSignalsFrom(noCounts, {
      currentAverage: 4,
      currentCount: 9,
      priorAverage: 4.4,
      priorCount: 10,
    })

    expect(result).toMatchObject({ ratingDrop: false, needsAttention: 0 })
  })
})
