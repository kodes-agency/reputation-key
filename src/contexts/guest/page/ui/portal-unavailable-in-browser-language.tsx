import { PortalUnavailable } from './portal-unavailable'
import { useBrowserUnavailableCopy } from './use-browser-unavailable-copy'

/**
 * The unavailable page for a render that has no server answer to read (a server
 * that could not respond, an address the router does not know): English first,
 * then the language the browser asks for once its pack has loaded.
 */
export function PortalUnavailableInBrowserLanguage() {
  return <PortalUnavailable copy={useBrowserUnavailableCopy()} />
}
