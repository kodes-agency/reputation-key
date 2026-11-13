import { describe, expect, it } from 'vitest'
import {
  staffColumns,
  staffGoalAnswer,
  staffGoalCaption,
  staffRatingsAnswer,
  staffRatingsHint,
  staffScansAnswer,
  staffScansQuestion,
} from './staff-results-words'

const goal = (name: string, scans: number, target: number) => ({
  id: name,
  name,
  scans,
  target,
})
const results = (over: Partial<Parameters<typeof staffRatingsAnswer>[0]>) => ({
  scans: 9,
  series: null,
  ...over,
})

describe('My results in plain words', () => {
  it('answers whether guests are scanning, for each period', () => {
    expect(staffScansAnswer(47, 'month')).toBe('Yes, 47 guests this month')
    expect(staffScansAnswer(1, 'today')).toBe('Yes, 1 guest today')
    expect(staffScansAnswer(0, 'week')).toBe('Not yet this week')
    expect(staffScansAnswer(0, 'last_month')).toBe('None last month')
    expect(staffScansQuestion('last_month')).toBe('Did guests scan your code?')
    expect(staffScansQuestion('month')).toBe('Are guests scanning your code?')
  })
  it('never shows an average below five ratings', () => {
    expect(staffRatingsAnswer(results({ ratingCount: 3 }), 'week')).toBe(
      '3 ratings so far',
    )
    expect(staffRatingsHint(results({ ratingCount: 3 }), 'week')).toBe(
      'Average shows after 5 ratings. Up to last night',
    )
    expect(staffRatingsAnswer(results({ ratingCount: 0 }), 'week')).toBe('No ratings yet')
    expect(staffRatingsHint(results({ ratingCount: 0 }), 'last_month')).toBeUndefined()
    expect(
      staffRatingsAnswer(results({ ratingCount: 12, averageRating: 4.62 }), 'month'),
    ).toBe('4.6★ from 12 ratings')
  })
  it('leads with the person’s own goal and says when one is shared', () => {
    const own = goal('Your goal', 47, 60)
    const shared = goal('Reception', 240, 400)
    expect(staffGoalAnswer([shared, own])).toBe('13 scans to go this month')
    expect(staffGoalAnswer([shared])).toBe('160 scans to go, shared with Reception')
    expect(staffGoalAnswer([goal('Your goal', 60, 60)])).toBe('Goal reached this month')
    expect(staffGoalCaption(own)).toBe('Your goal this month')
    expect(staffGoalCaption(shared)).toBe('Reception, shared this month')
    expect(staffGoalAnswer([])).toBe('')
  })
  it('marks only the column still counting as open', () => {
    const columns = staffColumns({
      unit: 'week',
      columns: [
        { start: '2026-11-02', scans: 19, open: false },
        { start: '2026-11-09', scans: 1, open: true },
      ],
    })
    expect(columns.map((column) => column.tone)).toEqual(['since', 'open'])
    expect(columns[0]?.label).toBe('Nov 2')
    expect(columns[1]?.line).toBe('Week of Nov 9: 1 scan')
  })
})
