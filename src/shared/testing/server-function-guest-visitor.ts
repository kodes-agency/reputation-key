// What a guest's browser does against the guest server functions, for a
// server-function harness test: open a published Portal to get its signed session,
// then carry that cookie and the page's CSRF nonce on every later call.

import type { CallRequest, CallResponse } from './server-function-request'
import type { ServerFunctionHarness } from './server-function-harness'
import type { TestPublishedPortal } from './server-function-portal-seeds'

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36'

/** The address of one venue's Wi-Fi, as the proxy forwards it. */
export const venueAddress = (last: number): Record<string, string> => ({
  'x-forwarded-for': `203.0.113.${last}`,
})

/** What the Portal page answers a first visit with: the nonce the browser then sends. */
type OpenedPage = Readonly<{ guestSession: Readonly<{ csrfNonce: string }> }>

export type GuestVisit<Page = OpenedPage> = Readonly<{
  /** Cookie pairs the browser keeps from the Portal's first answer. */
  cookies: readonly string[]
  csrfNonce: string
  page: Page
}>

export function guestRequest(
  visit: Pick<GuestVisit, 'cookies'>,
  extra: CallRequest = {},
): CallRequest {
  return {
    ...extra,
    headers: { 'user-agent': BROWSER_USER_AGENT, ...extra.headers },
    cookies: [...visit.cookies, ...(extra.cookies ?? [])],
  }
}

/**
 * Open the Portal's page as a new visitor (or, with `cookies`, a returning one):
 * `open` calls the page's server function with the address.
 */
export async function openVisit<Page extends OpenedPage>(
  harness: ServerFunctionHarness,
  open: (token: string) => Promise<Page>,
  token: string,
  request: CallRequest = {},
): Promise<GuestVisit<Page>> {
  const response = await harness.respondAs(null, () => open(token), {
    ...request,
    headers: { 'user-agent': BROWSER_USER_AGENT, ...request.headers },
  })
  if (!response.ok) throw response.error
  const issued = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
  return {
    cookies: [...issued, ...(request.cookies ?? [])],
    csrfNonce: response.value.guestSession.csrfNonce,
    page: response.value,
  }
}

const cookieName = (pair: string) => pair.split('=')[0] ?? ''

/** The browser after a response: cookies the call set replace the ones it held. */
export function visitAfter<Page extends OpenedPage>(
  visit: GuestVisit<Page>,
  headers: Headers,
  csrfNonce = visit.csrfNonce,
): GuestVisit<Page> {
  const set = headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '')
  const names = new Set(set.map(cookieName))
  return {
    ...visit,
    csrfNonce,
    cookies: [...visit.cookies.filter((pair) => !names.has(cookieName(pair))), ...set],
  }
}

/** A guest mutation from the visitor's browser, answered with its headers. */
export const guestCall = <T>(
  harness: ServerFunctionHarness,
  visit: GuestVisit,
  fn: (input: { data: never }) => Promise<T>,
  data: Record<string, unknown>,
  request: CallRequest = {},
) =>
  harness.respondAs(
    null,
    () => fn({ data: { csrfNonce: visit.csrfNonce, ...data } as never }),
    guestRequest(visit, request),
  )

export const portalBase = (portal: Pick<TestPublishedPortal, 'rawToken'>) => ({
  token: portal.rawToken ?? '',
})

export const ratingData = (
  portal: Pick<TestPublishedPortal, 'rawToken'>,
  rating = 5,
  extra: Record<string, unknown> = {},
) => ({ ...portalBase(portal), rating, responseConsent: true, ...extra })

export const answerOf = <T>(response: CallResponse<T>): T => {
  if (!response.ok) throw response.error
  return response.value
}

export const refusalOf = <T>(response: CallResponse<T>): unknown => {
  if (response.ok) throw new Error('The call was expected to be refused')
  return response.error
}
