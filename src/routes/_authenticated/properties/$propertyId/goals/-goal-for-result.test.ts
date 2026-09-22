import { describe, expect, it } from 'vitest'
import { goalForResult } from './-goal-for-result'

const programs = [
  { program: { id: 'goal-a' }, results: [{ id: 'result-1' }, { id: 'result-2' }] },
  { program: { id: 'goal-b' }, results: [{ id: 'result-3' }] },
]

// A goal notice links to the Goals page with the monthly result it reports;
// the page opens the goal that result belongs to.
describe('goalForResult', () => {
  it('finds the goal whose monthly results include the one a notice reports', () => {
    expect(goalForResult(programs, 'result-3')).toBe('goal-b')
  })

  it('finds nothing for a result this viewer cannot see, so the Goals page stays', () => {
    expect(goalForResult(programs, 'result-9')).toBeNull()
  })
})
