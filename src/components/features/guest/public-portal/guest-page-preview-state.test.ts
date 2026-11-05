import { describe, expect, it } from 'vitest'
import { previewResponseState } from './guest-page-preview-state'

describe('previewResponseState', () => {
  it.each([1, 2, 3, 4, 5])('keeps Google available at rating %s', (rating) => {
    const state = previewResponseState({ kind: 'rated', rating }, 3)
    expect(state.googleReviewAvailable).toBe(true)
    expect(state.response).toMatchObject({ rating, privateFeedbackEligible: rating <= 3 })
  })

  it('honours the preview threshold and explicitly pinned eligibility', () => {
    expect(
      previewResponseState({ kind: 'rated', rating: 4 }, 4).response
        ?.privateFeedbackEligible,
    ).toBe(true)
    expect(
      previewResponseState({ kind: 'rated', rating: 1, noteEligible: false }, 3).response
        ?.privateFeedbackEligible,
    ).toBe(false)
  })

  it.each(['arrival', 'direct'] as const)('has no saved response on %s', (kind) => {
    expect(previewResponseState({ kind }, 3)).toEqual({
      response: null,
      googleReviewAvailable: true,
    })
  })

  it('shows an eligible draft and a saved note as different states', () => {
    expect(previewResponseState({ kind: 'note-writing' }, 3).response).toMatchObject({
      hasPrivateFeedback: false,
      privateFeedbackEligible: true,
    })
    expect(previewResponseState({ kind: 'done' }, 3).response).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
  })

  it('keeps the rating when Google is unavailable', () => {
    expect(
      previewResponseState({ kind: 'googleUnavailable', rating: 2 }, 3),
    ).toMatchObject({ googleReviewAvailable: false, response: { rating: 2 } })
  })

  it('uses fixed deadlines so a preview renders the same everywhere', () => {
    const first = previewResponseState({ kind: 'rated', rating: 5 }, 3).response
    const second = previewResponseState({ kind: 'rated', rating: 5 }, 3).response
    expect(first).toEqual(second)
    expect(first?.correctionDeadline).toBe('2026-01-01T13:00:00.000Z')
  })
})
