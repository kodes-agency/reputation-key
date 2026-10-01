// Sign in through Better Auth and hand its session cookies to the browser.
// Shared by explicit sign-in and by registration, which signs the new member
// in once acceptance has verified the address.

import { getAuth } from '#/shared/auth/auth'

/**
 * Create a session for these credentials and forward its Set-Cookie headers.
 * Throws Better Auth's refusal unchanged; callers map it.
 */
export async function signInAndForwardCookies(
  email: string,
  password: string,
  headers: Headers,
): Promise<void> {
  // returnHeaders: true so Set-Cookie from better-auth reaches the browser.
  // Without this, server-fn sign-in creates a session that never sticks
  // (E2E stays on /login after submit; PR checks look "stuck" on timeouts).
  const signedIn = await getAuth().api.signInEmail({
    body: { email, password },
    headers,
    returnHeaders: true,
  })
  const { setResponseHeader } = await import('@tanstack/react-start/server')
  const setCookies =
    typeof signedIn.headers.getSetCookie === 'function'
      ? signedIn.headers.getSetCookie()
      : (() => {
          const single = signedIn.headers.get('set-cookie')
          return single ? [single] : []
        })()
  // One call with the ARRAY: setResponseHeader with a string does
  // headers.set (replace) — looping strings drops all but the last
  // cookie (better-auth sets session_token AND session_data; the
  // loop kept only session_data, so the session never stuck and the
  // app bounced back to /login). Array form deletes + appends each.
  if (setCookies.length > 0) {
    setResponseHeader('Set-Cookie', setCookies)
  }
}
