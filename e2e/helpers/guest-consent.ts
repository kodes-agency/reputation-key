// Analytics-notice helper for guest-portal specs.
//
// Two surfaces carry the notice. The legacy page (snapshot schema v1/v2) shows
// a `fixed bottom-0 z-50` bar: a region with a single acknowledge button. The
// Immersive Hub (schema v3) shows the same disclosure inline in its footer, as
// a region named "Visit counting" with the same "Got it" button; nothing is
// fixed and nothing can intercept a click. Pass the surface the portal under
// test renders. Everything below about the legacy bar holds for both
// the waiting and the one-call-per-guest rules.
//
// The bar is a `fixed bottom-0 z-50` region with a single acknowledge button.
// It is INFORMATIONAL, not a consent gate: `GuestAnalyticsNotice` records the
// portal visit from a mount effect regardless of the acknowledgement, and the
// dedupe that keeps one session counting once is storage-backed. The earlier
// `CookieConsentBanner` did offer Accept/Reject and did gate the scan; it was
// replaced in "fix(guest): harden public portal observations", which is why
// this helper no longer takes a decision.
//
// Specs still have to settle it, for one mechanical reason: the bar sits above
// the bottom of the page, so a click on the submit button or the trailing
// consent checkboxes can land on the bar instead ("element intercepts pointer
// events").

import type { Page } from '@playwright/test'

/**
 * Acknowledge the analytics notice. Resolves once the bar is gone.
 *
 * WAITS for the bar; it does not probe for it. The notice is deliberately
 * client-only — it starts hidden and a mount effect reads the persisted
 * acknowledgement out of `localStorage`, which the server cannot see — so it is
 * absent from the SSR document and appears only once hydration has run the
 * effect. `page.goto` resolves on `load`, which can be earlier than that. A
 * `if ((await notice.count()) === 0) return` guard therefore reads zero on a
 * page that is about to show the bar and turns the call into a silent no-op:
 * the bar stays up and intercepts pointer events on the trailing form controls.
 *
 * Consequently the notice is REQUIRED, not optional: call this once per guest,
 * on a portal that renders it. A guest who has already acknowledged never sees
 * the bar again, so a second call for the same guest waits for a bar that will
 * never come. To get an unacknowledged guest again, reset the browser's storage
 * and not only its cookies: the acknowledgement lives in `localStorage`.
 */
export type GuestSurface = 'legacy' | 'immersive'

/** The accessible name of the notice region on each surface (the guest copy packs' labels). */
const NOTICE_REGION_NAME: Readonly<Record<GuestSurface, string>> = {
  legacy: 'Portal analytics information',
  immersive: 'Visit counting',
}

export async function settleGuestConsent(
  page: Page,
  surface: GuestSurface = 'legacy',
): Promise<void> {
  const notice = page.getByRole('region', { name: NOTICE_REGION_NAME[surface] })
  await notice.waitFor({ state: 'visible' })
  await notice.getByRole('button', { name: 'Got it' }).click()
  await notice.waitFor({ state: 'detached' })
}
