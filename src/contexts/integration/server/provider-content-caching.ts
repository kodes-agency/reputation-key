import { setResponseHeader } from '@tanstack/react-start/server'

/** Provider content must never sit in a shared or browser cache. */
export function disableProviderContentCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}
