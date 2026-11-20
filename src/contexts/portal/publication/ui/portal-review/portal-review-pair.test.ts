import { describe, expect, it } from 'vitest'
import { describeGoogleCard, reviewPairStates } from './portal-review-pair'

describe('reviewPairStates', () => {
  it('draws the page after a 1 star and after a 5 star rating', () => {
    const [low, high] = reviewPairStates(3)

    expect(low).toMatchObject({
      rating: 1,
      label: '1★ Poor',
      state: { phase: 'rated', rating: 1, note: 'offered' },
    })
    expect(high).toMatchObject({
      rating: 5,
      label: '5★ Excellent',
      state: { phase: 'rated', rating: 5, note: 'none' },
    })
  })

  it('offers no private note after a 1 star rating when the portal offers none', () => {
    const [low] = reviewPairStates(0)

    expect(low?.state).toMatchObject({ rating: 1, note: 'none' })
  })

  it('offers the note after 5 stars when the threshold reaches 5', () => {
    const [, high] = reviewPairStates(5)

    expect(high?.state).toMatchObject({ rating: 5, note: 'offered' })
  })
})

describe('describeGoogleCard', () => {
  it('says guests get the same Google card, and where the private note is offered', () => {
    expect(describeGoogleCard(3)).toEqual({
      title: 'Every guest gets the same Google card',
      body: 'Once published, Google is offered the same way after every rating. At 3★ or below the page also offers an optional private note.',
    })
  })

  it('leaves the private note out when the portal offers none', () => {
    expect(describeGoogleCard(0).body).toBe(
      'Once published, Google is offered the same way after every rating.',
    )
  })

  it('says the note is offered after every rating at the top threshold', () => {
    expect(describeGoogleCard(5).body).toBe(
      'Once published, Google is offered the same way after every rating. The page also offers an optional private note after every rating.',
    )
  })
})
