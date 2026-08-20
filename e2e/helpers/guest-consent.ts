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
 * A no-op when the notice is absent — an unavailable portal never renders it,
 * and the decision persists for the browser context, so a second call after a
 * reload finds nothing to do.
 */
export async function settleGuestConsent(
  page: Page,
  decision: GuestConsentDecision = 'reject',
): Promise<void> {
  const notice = page.getByRole('region', { name: 'Analytics consent' })
  if ((await notice.count()) === 0) return
  await notice
    .getByRole('button', { name: decision === 'accept' ? 'Accept' : 'Reject' })
    .click()
  await notice.waitFor({ state: 'detached' })
}
