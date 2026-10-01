// The words the preview page prints that depend on a rating or a language:
// the pack's own text, with its placeholders filled by the pack's own rules.

import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  formatGuestPlural,
  guestCopyText,
  type GuestPortalCopyV2,
} from '#/components/features/guest'

export const RATINGS = [1, 2, 3, 4, 5] as const

/** "Poor", "Fair", "Good", "Very good", "Excellent" in the pack's language. */
export function ratingWord(pack: GuestPortalCopyV2, rating: number): string {
  switch (rating) {
    case 1:
      return pack.copy.ratingWord1
    case 2:
      return pack.copy.ratingWord2
    case 3:
      return pack.copy.ratingWord3
    case 4:
      return pack.copy.ratingWord4
    default:
      return pack.copy.ratingWord5
  }
}

/** "3 stars, Good": the accessible name of one rating choice. */
export function ratingOptionName(
  pack: GuestPortalCopyV2,
  locale: GuestLocale,
  rating: number,
): string {
  const stars = formatGuestPlural(
    pack.plurals.ratingStars,
    rating,
    GUEST_LOCALE_METADATA[locale].intlTag,
  )
  return guestCopyText(pack, 'ratingOption', { stars, word: ratingWord(pack, rating) })
}
