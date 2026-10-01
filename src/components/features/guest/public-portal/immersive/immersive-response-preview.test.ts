import { describe, expect, it } from 'vitest'
import { PACKS } from './__fixtures__/immersive-response-fixtures'
import { immersiveResponseProps } from './immersive-response-preview'

const build = (
  state: Parameters<typeof immersiveResponseProps>[0],
  privateFeedbackThreshold?: number,
) =>
  immersiveResponseProps(state, {
    pack: enV2,
    displayName: 'Avela Resort',
    privateFeedbackThreshold,
  })

function enPack(): (typeof PACKS)[number] {
  const pack = PACKS.find(({ locale }) => locale === 'en')
  if (!pack) throw new Error('the en pack is missing')
  return pack
}
const enV2 = enPack()

describe('immersiveResponseProps', () => {
  it('shows the rating card on arrival, with nothing saved', () => {
    const props = build({ kind: 'arrival' })
    expect(props.response).toBeNull()
    expect(props.availability).toBe('available')
    expect(props.googleReviewAvailable).toBe(true)
    expect(props.failure).toBeNull()
  })

  it.each([
    [1, true],
    [3, true],
    [4, false],
    [5, false],
  ])('rated(%i) is offered the note: %s (threshold 3)', (rating, eligible) => {
    expect(build({ kind: 'rated', rating }).response?.privateFeedbackEligible).toBe(
      eligible,
    )
  })

  it('opens the note with a draft for note-writing', () => {
    const props = build({ kind: 'note-writing', rating: 2, draft: 'Towels' })
    expect(props.noteDraft).toEqual({ open: true, text: 'Towels' })
    expect(props.response?.privateFeedbackEligible).toBe(true)
  })

  it('records a sent note for done', () => {
    const response = build({ kind: 'done' }).response
    expect(response?.hasPrivateFeedback).toBe(true)
    expect(response?.privateFeedbackEligible).toBe(false)
  })

  it('withdraws the Google link for googleUnavailable', () => {
    const props = build({ kind: 'googleUnavailable' })
    expect(props.googleReviewAvailable).toBe(false)
    expect(props.response?.rating).toBe(5)
  })

  it('wires inert handlers that change nothing', async () => {
    const props = build({ kind: 'arrival' })
    await expect(
      props.onSubmitRating({ rating: 3, honeypot: '' }),
    ).resolves.toBeUndefined()
    await expect(props.onSubmitNote({ text: 'x', honeypot: '' })).resolves.toBe(false)
    expect(props.onGoogleReview()).toBeUndefined()
  })
})
