import { setResponseHeader } from '@tanstack/react-start/server'

/** Provider content is the caller's alone: no shared or browser cache keeps it. */
export function disableProviderContentCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}
