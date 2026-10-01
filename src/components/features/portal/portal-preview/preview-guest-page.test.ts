import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadGuestPortalCopyV2 } from '#/components/features/guest'
import { PREVIEW_DRAFT } from './__fixtures__/portal-preview-fixtures'
import { ARRIVAL_STATE, ratedState } from './portal-preview-states'
import { PreviewGuestPage } from './preview-guest-page'

const pack = await loadGuestPortalCopyV2('en')
function englishExperience() {
  const experience = PREVIEW_DRAFT.experiences.en
  if (experience === undefined) throw new Error('the draft fixture has no English page')
  return experience
}

function render(state: Parameters<typeof PreviewGuestPage>[0]['state']): string {
  return renderToStaticMarkup(
    createElement(PreviewGuestPage, {
      experience: englishExperience(),
      copy: pack,
      locale: 'en',
      hasLanguageChip: true,
      state,
    }),
  )
}

describe('PreviewGuestPage response area', () => {
  it('draws the arrival page with the guest rating card', () => {
    const markup = render(ARRIVAL_STATE)

    expect(markup).toContain('data-ih-response="arrival"')
    expect(markup).toContain('ih-rating-card')
    expect(markup).toContain(pack.copy.ratingTitle)
  })

  it('draws the receipt, the Google card and the private note after a low rating', () => {
    const markup = render(ratedState(2, 3))

    expect(markup).toContain('data-ih-response="rated"')
    expect(markup).toContain(pack.copy.ratingThanks)
    expect(markup).toContain(pack.copy.googleTitle)
    expect(markup).toContain(pack.copy.noteOfferTitle)
  })

  it('offers no note after a high rating, and keeps the Google card where it was', () => {
    const markup = render(ratedState(5, 3))

    expect(markup).toContain(pack.copy.googleTitle)
    expect(markup).not.toContain(pack.copy.noteOfferTitle)
  })

  it('shows the note as sent once it was', () => {
    const markup = render({ phase: 'rated', rating: 2, note: 'sent' })

    expect(markup).toContain('ih-note--sent')
    expect(markup).not.toContain(pack.copy.noteOfferAction)
  })
})
