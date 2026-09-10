import { describe, expect, it } from 'vitest'
import { isAiIssueLabel, issueLabelReproducesSource } from './ai-issue-label'

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

describe('issue label source reproduction', () => {
  const review = 'The room was fine but the worst hotel ever experience was checkout.'

  it('refuses a multi-word label quoted from the review', () => {
    expect(issueLabelReproducesSource('worst hotel ever', review)).toBe(true)
  })

  it('allows a single word that necessarily appears in the source', () => {
    // `cleanliness` occurs in any review about cleanliness. Refusing it would
    // discard the discovery signal the open label exists to provide.
    expect(issueLabelReproducesSource('checkout', review)).toBe(false)
  })

  it('allows a multi-word category the guest did not phrase that way', () => {
    expect(issueLabelReproducesSource('checkout delay', review)).toBe(false)
  })

  it('matches on token boundaries, not incidental substrings', () => {
    expect(issueLabelReproducesSource('om was', review)).toBe(false)
  })

  it('folds case, width and whitespace before comparing', () => {
    expect(issueLabelReproducesSource('worst hotel', 'WORST   HOTEL stay')).toBe(true)
  })
})
