// The route template a browser error happened on, for error monitoring.
//
// router.tsx registers a reader of the router's current route in the browser.
// Only the template comes out ("/_authenticated/properties/$propertyId/inbox/"),
// never the address: the address holds the very identifiers the scrubber keeps
// out, and the threat model admits controlled route templates only. The
// server never registers one.

export type BrowserRouteSource = () => string | undefined

const ROUTE_TEMPLATE = /^(?:__root__|\/[A-Za-z0-9_$.()/-]{0,159})$/u

let source: BrowserRouteSource | undefined

export function setBrowserRouteSource(next: BrowserRouteSource | undefined): void {
  source = next
}

/** The current route template, or undefined when unknown or not template-shaped. */
export function browserRouteTemplate(): string | undefined {
  try {
    const template = source?.()
    return typeof template === 'string' && ROUTE_TEMPLATE.test(template)
      ? template
      : undefined
  } catch {
    // A failing reader must never stop an error report.
    return undefined
  }
}
