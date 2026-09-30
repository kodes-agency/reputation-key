import { useEffect, useRef } from 'react'

/**
 * A session that was seen active and is now gone.
 *
 * "Seen" is the point. A client's session state starts empty and is stale
 * after a sign-in that happened on the server (the sign-in is a server
 * function, so nothing tells the client), so "no session right now" cannot
 * tell a session that ended from one the client never learned of. Acting on it
 * would turn a fresh sign-in into a redirect.
 */
export function sessionEnded(wasSignedIn: boolean, isSignedIn: boolean): boolean {
  return wasSignedIn && !isSignedIn
}

/**
 * Runs `onEnd` when the signed-in state this page was showing goes away, from
 * anywhere: the page's own control, the header's user menu, another tab. The
 * header signs out without navigating, so a page that rendered for a signed-in
 * visitor would otherwise stay on screen with a dead session.
 */
export function useOnSessionEnd(isSignedIn: boolean, onEnd: () => void): void {
  const wasSignedIn = useRef(false)
  useEffect(() => {
    if (sessionEnded(wasSignedIn.current, isSignedIn)) onEnd()
    wasSignedIn.current = isSignedIn
  }, [isSignedIn, onEnd])
}
