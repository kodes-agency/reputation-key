import { setResponseHeader } from '@tanstack/react-start/server'

/** Nothing in the path may keep a copy of this response. */
export function disableResponseCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}
