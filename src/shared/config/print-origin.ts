// The shape of `PORTAL_PRINT_ORIGIN`, the short host a printed QR code or NFC tag
// carries (ADR 0069). Checked at boot, so a typo fails there and not when the
// first card is printed: a printed card cannot be redrawn.
//
// Pure, so env.ts can use it as a field check. The transport rule (https in
// production) is env.ts's, the same one it applies to the auth origin.

/**
 * The longest host that keeps `HTTPS://<host>/p/<20-character print code>` a
 * version 3 symbol at error correction M (ADR 0069): the first version 4 appears
 * at a 26-character host. The port counts, because the QR address carries it.
 */
export const PRINT_HOST_MAX_LENGTH = 25

/**
 * Why a value cannot name the print host, or undefined when it can. A message
 * never repeats the value, which may carry a pasted credential.
 */
export function printOriginProblem(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Must be an origin URL such as https://ap.up.railway.app'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Must be an http(s) origin'
  }
  if (url.username !== '' || url.password !== '') {
    return 'Must not carry credentials'
  }
  // A URL drops an empty query or fragment, so the raw text is what says there
  // was one. The path is the origin's own slash or nothing.
  if (url.pathname !== '/' || /[?#]/.test(value)) {
    return 'Must be an origin only, with no path, query or fragment'
  }
  if (url.host.length > PRINT_HOST_MAX_LENGTH) {
    return `Host must be at most ${PRINT_HOST_MAX_LENGTH} characters, so the printed QR stays a version 3 symbol`
  }
  return undefined
}
