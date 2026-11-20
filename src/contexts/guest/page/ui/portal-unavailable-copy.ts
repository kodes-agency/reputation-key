import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { GuestPortalCopy } from './public-portal/language-packs/guest-copy'

/** The words of the unavailable page in one language. */
export type PortalUnavailableCopy = Readonly<{
  locale: GuestLocale
  title: string
  body: string
  /** The label of the button that tries the page again. */
  retry: string
}>

/**
 * The unavailable page's words in one language, taken from that language's
 * copy pack so the page says exactly what the guest page says elsewhere.
 */
export function unavailableCopyOf(pack: GuestPortalCopy): PortalUnavailableCopy {
  return {
    locale: pack.locale,
    title: pack.copy.unavailableTitle,
    body: pack.copy.unavailableBody,
    retry: pack.copy.unavailableRetry,
  }
}

/**
 * English, written out so the page can draw without loading a pack: it is what
 * a visitor sees when their browser asks for no language the guest surface has,
 * and the second line under any other language. A test holds these words to the
 * English pack.
 */
export const PORTAL_UNAVAILABLE_ENGLISH: PortalUnavailableCopy = {
  locale: 'en',
  title: 'This page isn’t available right now.',
  body: 'Please check back later.',
  retry: 'Try again',
}
