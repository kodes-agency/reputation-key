import { useEffect, useState } from 'react'
import { preferredGuestLocale } from '#/contexts/guest/application/preferred-guest-locale'
import { captureBrowserException } from '#/shared/observability/browser-exception-capture'
import { unavailableCopyOf, type PortalUnavailableCopy } from './portal-unavailable-copy'

/**
 * The unavailable page's words in the language the visitor's browser asks for,
 * for the pages that render without the server's answer (a server that could
 * not respond, an address the router does not know). It starts as `undefined`,
 * which the page draws in English, and becomes the browser's language once that
 * one copy pack has loaded, so the server render and the hydration agree.
 *
 * Not finding or loading a pack leaves the English page, which is a complete
 * page: the failure is reported, not shown.
 */
export function useBrowserUnavailableCopy(): PortalUnavailableCopy | undefined {
  const [copy, setCopy] = useState<PortalUnavailableCopy | null>(null)
  useEffect(() => {
    const locale = preferredGuestLocale(navigator.languages)
    if (locale === 'en') return undefined
    let isCancelled = false
    // A dynamic import of the loader's own module: the route's critical chunk
    // must not carry a copy pack, and this loads exactly one.
    void import('./public-portal/language-packs/load-guest-copy-v2')
      .then((loader) => loader.loadGuestPortalCopyV2(locale))
      .then((pack) => {
        if (!isCancelled) setCopy(unavailableCopyOf(pack))
      })
      .catch(captureBrowserException)
    return () => {
      isCancelled = true
    }
  }, [])
  return copy ?? undefined
}
