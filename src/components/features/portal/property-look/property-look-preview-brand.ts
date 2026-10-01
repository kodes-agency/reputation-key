// The preview's brand with the draft laid over it: the page follows the person's
// edits as they make them, without waiting for the autosave and a re-read. The
// guest page still resolves the colours itself (and falls back where it must),
// so what is drawn is what a guest would get once the draft is published.
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import { lookFieldOf } from '#/shared/domain/portal-look-readout'
import type { LookDraft } from './property-look-rules'

type Brand = PortalPreviewExperience['brand']

/**
 * The page's own photograph and logo, as the person has them now (a photograph
 * just chosen in the dialog, a focal point still being dragged), which the
 * preview draws in place of what it last read from the server.
 */
export type PreviewMedia = Readonly<{
  hero: NonNullable<Brand['hero']> | null
  logo: NonNullable<Brand['logo']> | null
}>

const heroOf = (hero: NonNullable<Brand['hero']>) => ({
  url: hero.url,
  width: hero.width,
  height: hero.height,
  focalX: hero.focalX,
  focalY: hero.focalY,
})

export function previewBrandOf(
  brand: Brand,
  draft: LookDraft,
  showPhoto: boolean,
  media?: PreviewMedia,
): Brand {
  const hero = media ? media.hero : brand.hero
  const logo = media ? media.logo : brand.logo
  const field = lookFieldOf({
    accent: draft.accent,
    backgroundMode: draft.backgroundMode,
    backgroundColour: draft.field,
  })
  const wordmark = draft.wordmark.trim()
  return {
    ...brand,
    ...(field === null ? {} : { accentColour: draft.accent, fieldColour: field }),
    wordmark: wordmark === '' ? null : wordmark,
    logo: logo ? { url: logo.url, width: logo.width, height: logo.height } : null,
    hero: showPhoto && hero ? heroOf(hero) : null,
  }
}
