// The preview's brand with the draft laid over it: the page follows the person's
// edits as they make them, without waiting for the autosave and a re-read. The
// guest page still resolves the colours itself (and falls back where it must),
// so what is drawn is what a guest would get once the draft is published.
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import { lookFieldOf } from '#/shared/domain/portal-look-readout'
import type { LookDraft } from './property-look-rules'

type Brand = PortalPreviewExperience['brand']

export function previewBrandOf(
  brand: Brand,
  draft: LookDraft,
  showPhoto: boolean,
): Brand {
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
    hero: showPhoto ? brand.hero : null,
  }
}
