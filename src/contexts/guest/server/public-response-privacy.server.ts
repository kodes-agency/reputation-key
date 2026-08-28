import { setResponseHeader } from '@tanstack/react-start/server'

/**
 * Apply before any handler branch: Guest responses can carry recovery state,
 * policy outcomes, or a destination selected from private Portal configuration.
 */
export function applyGuestPublicResponsePrivacy(
  options: Readonly<{ varyCookie?: boolean }> = {},
): void {
  setResponseHeader('Cache-Control', 'private, no-store')
  if (options.varyCookie !== false) setResponseHeader('Vary', 'Cookie')
  setResponseHeader('Referrer-Policy', 'no-referrer')
}

/**
 * TanStack validates server-function input before entering the handler. Wrap
 * every public Guest parser so malformed requests receive the same privacy
 * policy as successful and domain-error responses.
 */
export function guestPublicResponseValidator<Output>(
  parser: Readonly<{ parse: (input: unknown) => Output }>,
  options: Readonly<{ varyCookie?: boolean }> = {},
): (input: unknown) => Output {
  return (input) => {
    applyGuestPublicResponsePrivacy(options)
    return parser.parse(input)
  }
}
