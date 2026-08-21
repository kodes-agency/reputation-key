// Analytics-consent helper for guest-portal specs.
//
// The consent notice is a `fixed bottom-0 z-50` bar with an explicit
// Reject/Accept pair (it replaced a dismiss-only bar that satisfied nothing and
// left `portal.scan` permanently 0). Two reasons a spec must settle it before
// touching the response form:
//
//  1. Realism — a guest decides before interacting. Leaving the bar up tests a
//     state real guests spend seconds in.
//  2. Mechanics — the bar sits above the bottom of the page, so a click on the
//     submit button or the trailing consent checkboxes can land on the bar
//     instead ("element intercepts pointer events").
//
// `reject` is the default because it records nothing: a spec that asserts on
// request traffic or scan counts keeps its baseline. Pass `accept` only when the
// spec means to exercise the scan path.

import type { Page } from '@playwright/test'

export type GuestConsentDecision = 'accept' | 'reject'

/**
 * Settle the analytics-consent notice. Resolves once the bar is gone.
 *
 * WAITS for the bar; it does not probe for it. The notice is deliberately
 * client-only — it starts hidden and a mount effect reads the persisted decision
 * out of `localStorage`, which the server cannot see — so it is absent from the
 * SSR document and appears only once hydration has run the effect. `page.goto`
 * resolves on `load`, which can be earlier than that. The previous
 * `if ((await notice.count()) === 0) return` guard therefore read zero on a page
 * that was about to show the bar and turned every call into a silent no-op: the
 * bar stayed up and intercepted pointer events on the trailing form controls,
 * and `accept` was never clicked, so `portal.scan` never got its producer.
 *
 * Consequently the notice is REQUIRED, not optional: call this once per guest,
 * on a portal that renders it. A guest who has already decided never sees the
 * bar again — that is the product rule, pinned by the `Already Denied` and
 * `Already Granted` stories on `CookieConsentBanner` — so a second call for the
 * same guest waits for a bar that will never come instead of quietly doing
 * nothing. To get an undecided guest again, reset the browser's storage and not
 * only its cookies: the decision lives in `localStorage`, not in a cookie.
 */
export async function settleGuestConsent(
  page: Page,
  decision: GuestConsentDecision = 'reject',
): Promise<void> {
  const notice = page.getByRole('region', { name: 'Analytics consent' })
  await notice.waitFor({ state: 'visible' })
  await notice
    .getByRole('button', { name: decision === 'accept' ? 'Accept' : 'Reject' })
    .click()
  await notice.waitFor({ state: 'detached' })
}
