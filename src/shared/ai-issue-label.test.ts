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

  // A label holds letters and single spaces only, so a copied phrase can never
  // carry the punctuation that touched it in the review. Guests end sentences
  // and clauses with exactly the short phrases a label is made of.
  it.each([
    ['rude staff', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['worst hotel ever', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['dirty rooms', 'Dirty rooms, rude staff. Worst hotel ever!'],
    ['slow service', 'We left because of the (slow service).'],
    ['cold food', 'Two words: "cold food"'],
    ['long wait', 'The check-in?! Long wait; never again'],
    ['noisy room', 'noisy room'],
    ['broken shower', 'Bad stay—broken shower… and no apology'],
    ['check in', 'Check-in took an hour.'],
  ])('refuses %j quoted next to punctuation in %j', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  it.each([
    ['staff didnt care', "The staff didn't care at all."],
    ['staff didnt care', 'The staff didn’t care at all.'],
    ['habitacion sucia', 'Una habitación sucia y fría.'],
  ])('refuses %j copied from %j with the marks a label cannot hold', (label, source) => {
    expect(issueLabelReproducesSource(label, source)).toBe(true)
  })

  it('still allows a single word that sits next to punctuation', () => {
    expect(issueLabelReproducesSource('checkout', 'Slow checkout. Nice pool!')).toBe(
      false,
    )
  })

  it('still allows a category whose words the guest wrote apart', () => {
    expect(
      issueLabelReproducesSource('rude staff', 'Rude, loud and unhelpful staff.'),
    ).toBe(false)
  })

  it('does not join the halves of a word that punctuation splits', () => {
    expect(issueLabelReproducesSource('heck in', 'Check-in took an hour.')).toBe(false)
  })
})
