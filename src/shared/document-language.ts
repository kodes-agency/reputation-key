// The language of the document. The public guest portal is rendered entirely in
// the guest's locale and carries none of the app chrome, so a document that
// kept claiming English would misdescribe every word on it. `lang` is not
// decoration: it selects the screen-reader voice, offers the right translation
// prompt and drives hyphenation.
//
// Pure on purpose: no I/O, no framework import, so it is testable in node.

import { isGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'

type PortalLoaderData = { localization?: { selectedLocale?: unknown } } | null | undefined

/**
 * The guest locale the portal route rendered in, any of the six, or English for
 * every other page (and for a portal whose loader names no known locale).
 */
export function documentLanguageOfMatches(
  matches: readonly Readonly<{ routeId: string; loaderData?: unknown }>[],
): GuestLocale {
  const portal = matches.find((match) => match.routeId === '/p/$token')
  const locale = (portal?.loaderData as PortalLoaderData)?.localization?.selectedLocale
  return isGuestLocale(locale) ? locale : 'en'
}
