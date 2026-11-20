// ADR 0044: Google visibility, position and wording are invariant across ratings.
// Exercise the live page container and the inert preview with the same response.
import { describe, expect, it } from 'vitest'
import { directChildren, text } from './__fixtures__/markup-walk'
import {
  PACKS,
  RATINGS,
  renderResponse,
} from './immersive/__fixtures__/immersive-response-fixtures'
import {
  RATED,
  renderImmersivePortal,
} from './immersive/__fixtures__/immersive-public-portal-fixtures'

// React assigns different ids when the view sits inside the whole page.
const cards = (html: string) =>
  directChildren(html, 'data-ih-response').map((card) =>
    card.replace(/_R_[a-zA-Z0-9]+_/gu, '_id_'),
  )

describe.each(PACKS)('the Google action on the guest page [$locale]', (pack) => {
  it('is identical in the live page and preview for ratings 1–5, before and after a note', () => {
    const googleCards: string[] = []
    for (const rating of RATINGS) {
      for (const noteSent of [false, true]) {
        const response = {
          ...RATED,
          rating,
          privateFeedbackEligible: !noteSent && rating <= 3,
          hasPrivateFeedback: noteSent,
        }
        const variants = [
          renderResponse(pack, { kind: noteSent ? 'done' : 'rated', rating }),
          renderImmersivePortal({
            pack,
            selectedLocale: pack.locale,
            initialResponse: response,
          }),
        ]
        for (const html of variants) {
          const children = cards(html)
          expect(children.findIndex((card) => card.includes(pack.copy.googleTitle))).toBe(
            1,
          )
          const card = children[1] ?? ''
          expect(card).toContain(pack.copy.googleBody)
          expect(text(card)).toContain(pack.copy.googleAction)
          expect(card).not.toMatch(/<button\b[^>]*\sdisabled(?=[\s=>])/u)
          googleCards.push(card)
        }
      }
    }
    expect(new Set(googleCards).size).toBe(1)
  })

  it('keeps the same unavailable Google card for every rating on both paths', () => {
    const unavailable = RATINGS.flatMap((rating) => [
      renderResponse(pack, { kind: 'googleUnavailable', rating }),
      renderImmersivePortal({
        pack,
        selectedLocale: pack.locale,
        googleReview: { status: 'unavailable' },
        initialResponse: { ...RATED, rating },
      }),
    ]).map(cards)
    expect(new Set(unavailable.map((children) => children[1])).size).toBe(1)
    for (const children of unavailable) {
      expect(children[1]).toContain(pack.copy.googleUnavailableTitle)
      expect(children.join('')).not.toContain(pack.copy.googleAction)
    }
  })
})

describe.each(PACKS)('a dropped response on the guest page [$locale]', (pack) => {
  it.each([1, 2, 3, 4, 5, null])(
    'keeps the thank-you and identical Google card after reload, rating %s',
    (rating) => {
      const dropped = {
        ...RATED,
        dropped: true as const,
        rating,
        privateFeedbackEligible: false,
        correctionAvailable: false,
        responseWithdrawalAvailable: false,
        feedbackWithdrawalAvailable: false,
        correctionDeadline: null,
        responseWithdrawalDeadline: null,
      }
      const html = renderImmersivePortal({
        pack,
        selectedLocale: pack.locale,
        initialResponse: dropped,
      })
      const stored = renderImmersivePortal({
        pack,
        selectedLocale: pack.locale,
        initialResponse: { ...RATED, rating: 5 },
      })
      expect(cards(html)[0]).toContain(pack.copy.ratingThanks)
      expect(cards(html)[1]).toEqual(cards(stored)[1])
      const responseText = text(cards(html).join(''))
      expect(responseText).not.toContain(pack.copy.ratingChange)
      expect(responseText).not.toContain(pack.copy.responseRemoveAllAction)
      expect(responseText).not.toContain(pack.copy.responseRemoveNoteAction)
    },
  )
})
