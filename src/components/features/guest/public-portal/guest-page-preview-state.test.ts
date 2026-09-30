import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'
import {
  previewFormViewProps,
  type GuestPagePreviewState,
} from './guest-page-preview-state'

const copy = getGuestPortalCopy('en', 'guest-ui-en-v1')
const build = (state: GuestPagePreviewState, privateFeedbackThreshold?: number) =>
  previewFormViewProps(state, { copy, privateFeedbackThreshold })

describe('previewFormViewProps', () => {
  it('shows the rating form on arrival, with nothing saved yet', () => {
    const props = build({ kind: 'arrival' })

    expect(props.response).toBeNull()
    expect(props.availability).toBe('available')
    expect(props.googleReviewAvailable).toBe(true)
    expect(props.message).toBe('')
  })

  it.each([
    [1, true],
    [3, true],
    [4, false],
    [5, false],
  ])('rated(%i) derives note eligibility from the threshold: %s', (rating, eligible) => {
    const props = build({ kind: 'rated', rating })

    expect(props.response?.rating).toBe(rating)
    expect(props.response?.privateFeedbackEligible).toBe(eligible)
    expect(props.response?.hasPrivateFeedback).toBe(false)
  })

  it('honours a different threshold', () => {
    expect(build({ kind: 'rated', rating: 4 }, 4).response?.privateFeedbackEligible).toBe(
      true,
    )
  })

  it('lets a caller pin eligibility independently of the rating', () => {
    const props = build({ kind: 'rated', rating: 5, noteEligible: true })

    expect(props.response?.rating).toBe(5)
    expect(props.response?.privateFeedbackEligible).toBe(true)
  })

  it('note-writing is a low rating with the note still to write', () => {
    const props = build({ kind: 'note-writing' })

    expect(props.response?.privateFeedbackEligible).toBe(true)
    expect(props.response?.hasPrivateFeedback).toBe(false)
  })

  it('done has the note sent and the sent notice showing', () => {
    const props = build({ kind: 'done' })

    expect(props.response?.hasPrivateFeedback).toBe(true)
    expect(props.response?.privateFeedbackEligible).toBe(false)
    expect(props.message).toBe(copy.feedbackSent)
  })

  it('googleUnavailable keeps the rating and drops only the Google action', () => {
    const props = build({ kind: 'googleUnavailable', rating: 5 })

    expect(props.googleReviewAvailable).toBe(false)
    expect(props.response?.rating).toBe(5)
  })

  it('never carries a live action: every handler is inert', async () => {
    const props = build({ kind: 'rated', rating: 2 })

    await expect(
      props.onSubmitRating({ rating: 4, honeypot: '' }),
    ).resolves.toBeUndefined()
    await expect(props.onSubmitFeedback({ text: 'x', honeypot: '' })).resolves.toBe(false)
    expect(() => {
      props.onGoogleReview()
      props.onStartCorrection()
      props.onStartNewResponse()
      props.onWithdraw()
      props.onWithdrawFeedback()
    }).not.toThrow()
  })

  it('uses fixed deadlines so a preview renders the same everywhere', () => {
    const first = build({ kind: 'rated', rating: 5 }).response
    const second = build({ kind: 'rated', rating: 5 }).response

    expect(first).toEqual(second)
    expect(first?.correctionDeadline).toBe('2026-01-01T13:00:00.000Z')
  })
})
