import { describe, expect, it } from 'vitest'
import { ATTENTION_OPTIONS } from './inbox-filter-options'
import { priorityFilterLevels } from './inbox-priority-filter'

describe('priorityFilterLevels', () => {
  it('asks the server for both levels behind "Urgent and High"', () => {
    expect(priorityFilterLevels('urgent_high')).toEqual(['urgent', 'high'])
  })

  it('passes one level, and no filter, through unchanged', () => {
    expect(priorityFilterLevels('medium')).toBe('medium')
    expect(priorityFilterLevels(undefined)).toBeUndefined()
  })

  it('offers the combined choice right after "All priorities"', () => {
    expect(ATTENTION_OPTIONS.map((option) => option.label)).toEqual([
      'All priorities',
      'Urgent and High',
      'Urgent',
      'High',
      'Medium',
      'Low',
    ])
  })
})
