// What the editor's phone shows of a look edit before the draft is read again: the
// edit laid over the brand the preview last read, so a colour, a wordmark or the
// focus point follows the person's hand at once instead of after the autosave and
// the read that follows it. The guest page still resolves the colours itself, so
// what is drawn is what a guest would get once the portal is published.
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import { lookFieldOf } from '#/shared/domain/portal-look-readout'
import type { FocalPoint } from '../property-look/focal-point'
import type { ColoursDraft } from '../property-look/property-look-colours-section'

export type PreviewBrand = PortalPreviewExperience['brand']

/** One edit, laid over the brand. */
export type BrandPatch = (brand: PreviewBrand) => PreviewBrand

/** The edits that can be in flight, one slot each: an edit of the same kind replaces the last. */
export type BrandPatchKey = 'colours' | 'wordmark' | 'focal'

export type BrandPatches = Readonly<Partial<Record<BrandPatchKey, BrandPatch>>>

/** The colours drawn for a draft; null while the colours are not a pair the page can draw. */
export function coloursPatchOf(draft: ColoursDraft): BrandPatch | null {
  const field = lookFieldOf({
    accent: draft.accent,
    backgroundMode: draft.backgroundMode,
    backgroundColour: draft.field,
  })
  return field === null
    ? null
    : (brand) => ({ ...brand, accentColour: draft.accent, fieldColour: field })
}

/** The wordmark drawn for what is typed; empty shows the display name. */
export function wordmarkPatchOf(wordmark: string): BrandPatch {
  const trimmed = wordmark.trim()
  return (brand) => ({ ...brand, wordmark: trimmed === '' ? null : trimmed })
}

/** The photograph as the circle has it now; a page with no photograph has nothing to crop. */
export function focalPatchOf(focal: FocalPoint): BrandPatch {
  return (brand) =>
    brand.hero
      ? { ...brand, hero: { ...brand.hero, focalX: focal.x, focalY: focal.y } }
      : brand
}

/** The brand with every edit in flight laid over it, or the brand itself when there are none. */
export function patchedBrand(brand: PreviewBrand, patches: BrandPatches): PreviewBrand {
  return Object.values(patches).reduce((current, patch) => patch(current), brand)
}

/** The patches with one slot set, or taken out for null; the others are kept. */
export function withBrandPatch(
  patches: BrandPatches,
  key: BrandPatchKey,
  patch: BrandPatch | null,
): BrandPatches {
  const { [key]: _replaced, ...rest } = patches
  void _replaced
  return patch === null ? rest : { ...rest, [key]: patch }
}
