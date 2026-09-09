import { describe, expect, it } from 'vitest'
import { isAiIssueLabel } from './ai-issue-label'

describe('AI issue label rule', () => {
  it('accepts bounded lowercase category phrases', () => {
    expect(isAiIssueLabel('slow front desk response')).toBe(true)
    expect(isAiIssueLabel('wifi')).toBe(true)
  })

  it.each([
    '',
    'five words are one too many',
    'Dirty rooms',
    'dirty-room',
    'dirty  room',
    'a'.repeat(41),
  ])('rejects %j', (value) => {
    expect(isAiIssueLabel(value)).toBe(false)
  })
})
