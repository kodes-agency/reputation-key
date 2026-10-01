import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { guestCopyText, loadGuestPortalCopyV2 } from '#/components/features/guest'
import { PREVIEW_DRAFT } from './__fixtures__/portal-preview-fixtures'
import { ARRIVAL_STATE, ratedState } from './portal-preview-states'
import { PreviewGuestPage } from './preview-guest-page'

const pack = await loadGuestPortalCopyV2('en')
function englishExperience() {
  const experience = PREVIEW_DRAFT.experiences.en
  if (experience === undefined) throw new Error('the draft fixture has no English page')
  return experience
}

const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

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

describe('PreviewGuestPage draws the real guest page', () => {
  // The hoisted stylesheets name classes and addresses of their own.
  const markup = withoutStyle(render(ARRIVAL_STATE))

  it('draws the real header, title block and footer, not stand-ins', () => {
    expect(markup).toContain('class="ih-header"')
    expect(markup).toContain('ih-wordmark')
    expect(markup).toContain('class="ih-title"')
    expect(markup).toContain('ih-title__kicker')
    expect(markup).toContain('class="ih-footer"')
  })

  it('draws the footer with the full disclosure, the one guests read', () => {
    const detail = guestCopyText(pack, 'visitNoticeDetail', { name: 'Avela Resort' })
    expect(markup).toContain(detail.replace(/&/gu, '&amp;'))
    expect(markup).toContain('ih-footer__notice')
    expect(markup).toContain(pack.copy.visitNoticeAcknowledge)
  })

  it('draws the photo tile the Linktree has, as the real photo tile', () => {
    expect(markup).toContain('ih-tile--photo')
    expect(markup).toContain('Discover the resort')
    expect(markup).toMatch(/<img[^>]*class="ih-tile__image"/u)
  })

  it('keeps the waiting tile as a variant of the real tile, with the reason', () => {
    expect(markup).toContain('ih-tile--waiting')
    expect(markup).toContain('data-ih-tile-placeholder="awaiting_approval"')
    expect(markup).toContain('Waiting for approval')
    expect(markup).toContain('Olive Terrace menu')
  })

  it('draws the language chip as a picture of the real chip', () => {
    expect(markup).toContain('ih-chip')
    expect(markup).toContain('>EN<')
    expect(markup).not.toContain('<dialog')
  })

  it('draws no chip when the portal has one language', () => {
    const single = renderToStaticMarkup(
      createElement(PreviewGuestPage, {
        experience: englishExperience(),
        copy: pack,
        locale: 'en',
        hasLanguageChip: false,
        state: ARRIVAL_STATE,
      }),
    )
    expect(withoutStyle(single)).not.toContain('ih-chip')
  })

  it('has nothing to follow: no address and no dialog anywhere on the page', () => {
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('<dialog')
  })

  it('keeps the two parts the Review phones scroll to', () => {
    expect(markup).toMatch(/data-preview-part="welcome"/u)
    expect(markup).toMatch(/data-preview-part="linktree"/u)
  })

  it('draws no Linktree part when it is switched off', () => {
    const experience = englishExperience()
    const off = renderToStaticMarkup(
      createElement(PreviewGuestPage, {
        experience: { ...experience, linktree: { enabled: false } },
        copy: pack,
        locale: 'en',
        hasLanguageChip: true,
        state: ARRIVAL_STATE,
      }),
    )
    expect(withoutStyle(off)).not.toContain('data-preview-part="linktree"')
    expect(withoutStyle(off)).not.toContain('ih-linktree')
  })
})
