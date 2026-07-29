// BQC-6.6 — dark-context browser promotion.
//
// PROMOTES the BQC-2/BQC-3 lower-level matrices to the browser/direct-navigation
// layer; it does NOT recreate them. The server-side proofs stay where they are
// (all green, cited — not re-asserted here):
//   - src/shared/auth/dark-context-matrix.test.ts          — server fns deny while dark
//   - src/shared/auth/dark-capability-enforcement.test.ts  — jobs/schedules gated (incl.
//     notification.send_email as a worker-job no-op at bootstrap.ts and the worker
//     schedule gate) — the outbound-email proof cited in (d), not recreated
//   - src/shared/auth/portal-capability-taxonomy.test.ts   — portal read/write/upload split
//   - src/shared/architecture/dark-consumer-gating.test.ts — event consumers gated
//   - src/shared/architecture/context-acceptance-matrix.test.ts
//   - src/shared/architecture/no-auto-publish.test.ts      — publish enqueue exists ONLY
//     behind manager-gated approve/retry/edit (cited in (f), not recreated)
//
// What this spec adds (the only thing those matrices cannot see): the BROWSER
// surface — intentional unavailable/denied UX on direct navigation, and proof
// of ZERO browser-initiated mutation / upload / export / external-service call
// (attachRequestLog — the 6.2 harness records detections, not request absence).
//
// Postures: the LOCKED server (:3001, BETA_E2E_GLOBAL_CAPABILITIES empty — the
// real beta posture) carries the denial matrix. The permissive server (:3000)
// is used ONLY to prove BLOCKED capabilities (portal.write, portal.read) stay
// denied even when the e2e allowlist is on. Dark capabilities are never
// globally enabled for regression coverage.

import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { requireE2eSeedState } from '../helpers/seed-state'
import { attachRequestLog } from '../helpers/request-log'
import {
  cleanupE2eData,
  e2eRunId,
  seedInboxItemForReview,
  seedReview,
} from '../helpers/fixtures'

const LOCKED_ORIGIN = 'http://localhost:3001'
const LOCKED_HOST = 'localhost:3001'
const PERMISSIVE_ORIGIN = 'http://localhost:3000'
const PERMISSIVE_HOST = 'localhost:3000'

test.use({ baseURL: LOCKED_ORIGIN })

const seed = requireE2eSeedState()

// ── Shared assertions ───────────────────────────────────────────────

/**
 * The gate's intentional UX: /unavailable?feature=<label> renders the
 * AuthCard ("<Feature> isn't available yet") — never the default 500 error
 * component (destructive role=alert).
 */
async function expectIntentionalUnavailable(page: Page, feature: string) {
  await expect(page).toHaveURL(/\/unavailable/)
  expect(new URL(page.url()).searchParams.get('feature')).toBe(feature)
  await expect(page.getByText(`${feature} isn't available yet`)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
}

/**
 * The guest portal's intentional UX (BQC-6.6 fix): the SAME PortalUnavailable
 * the notFound path renders — a dark portal (portal.read off) must not land on
 * the default 500 error component. The SSR document status stays 500 (error
 * boundary semantics — the denial is logged server-side); the 6.2 harness
 * gates mutations, not document statuses, so the rendered UX is the assertion.
 */
async function expectGuestPortalUnavailable(page: Page) {
  await expect(page.getByRole('heading', { name: 'Portal Unavailable' })).toBeVisible()
  await expect(page.getByText('Please try again later.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
}

/** AI affordance scan — no AI/assistant/generate control or copy may exist in
 * the app shell. (The decorative Sparkles in goal-create-preview is behind the
 * goal gate, which (a) proves unreachable in the locked posture.) */
const AI_AFFORDANCE = /\bAI\b|assistant|sparkles?|generat/i

async function expectNoAiAffordance(page: Page) {
  for (const role of ['button', 'link', 'switch', 'menuitem', 'tab'] as const) {
    await expect(page.getByRole(role, { name: AI_AFFORDANCE })).toHaveCount(0)
  }
  await expect(page.getByText(AI_AFFORDANCE)).toHaveCount(0)
  await expect(page.getByPlaceholder(AI_AFFORDANCE)).toHaveCount(0)
}

// ── (a) Dark routes: direct navigation ──────────────────────────────

/** The dark-route matrix: path → the feature label gateDarkRoute reports. */
const DARK_ROUTES: ReadonlyArray<{ path: string; feature: string }> = [
  { path: '/leaderboard', feature: 'Leaderboard' },
  { path: '/team', feature: 'Teams' },
  { path: '/progress', feature: 'Goals' },
  { path: `/properties/${seed.propertyId}/teams/e2e-dark-team`, feature: 'Teams' },
  { path: `/properties/${seed.propertyId}/portals`, feature: 'Portals' },
  {
    path: `/properties/${seed.propertyId}/portals/e2e-dark-portal`,
    feature: 'Portals',
  },
  { path: `/properties/${seed.propertyId}/goals`, feature: 'Goals' },
  { path: `/properties/${seed.propertyId}/goals/new`, feature: 'Goals' },
  { path: '/settings/recognition', feature: 'Recognition' },
]

test.describe('Critical: dark-context browser promotion (locked posture)', () => {
  test('(a) direct navigation to every dark route renders the intentional unavailable UX', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    for (const { path, feature } of DARK_ROUTES) {
      await page.goto(path)
      await expectIntentionalUnavailable(page, feature)
    }

    // No browser-initiated mutation/upload/export: the only server-fn traffic
    // a gated navigation produces is the gate's own GET RPC. No external call.
    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  test('(a) sidebar links exercise the same gate (client-side navigation)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    // The sidebar renders dark items unconditionally (no capability filter),
    // so clicking routes through the identical beforeLoad gate.
    await page.goto(`/properties/${seed.propertyId}`)
    const goalsLink = page.getByRole('link', { name: 'Goals', exact: true })
    await expect(goalsLink).toBeVisible()
    await goalsLink.click()
    await expectIntentionalUnavailable(page, 'Goals')

    await page.goto(`/properties/${seed.propertyId}`)
    const leaderboardLink = page.getByRole('link', {
      name: 'Leaderboard',
      exact: true,
    })
    await expect(leaderboardLink).toBeVisible()
    await leaderboardLink.click()
    await expectIntentionalUnavailable(page, 'Leaderboard')

    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  // ── (b) portal.write is BLOCKED — denied in BOTH postures ──────────

  test('(b) portal create route redirects to unavailable and never mounts the form (locked)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    await page.goto(`/properties/${seed.propertyId}/portals/new`)
    await expectIntentionalUnavailable(page, 'Portals')
    // The create form never mounts (no QR/upload affordance is reachable).
    await expect(page.getByText('New Portal')).toHaveCount(0)
    await expect(
      page.getByText('Create a guest-facing portal page for this property.'),
    ).toHaveCount(0)

    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  // ── (c) Guest public portal denied ─────────────────────────────────

  test('(c) guest public portal renders the intentional unavailable UX; no scan mutation fires (locked)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)

    // Deny fires before slug resolution, so arbitrary slugs exercise the gate.
    await page.goto('/p/no-such-property/no-such-portal')
    await expectGuestPortalUnavailable(page)

    // PublicPortalPage never mounts → the recordScan useEffect never runs →
    // ZERO mutation requests (recordScanFn is a POST /_server).
    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  // ── (d) Outbound email: preferences surface only, no external send ──

  test('(d) notification settings offer preference writes only — no external-send surface or call (locked)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    await page.goto('/settings/notifications')
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    // The Email switches write per-type channel PREFERENCES
    // (updateNotificationPreferenceFn — notification.in_app is core). No
    // toggle offers external-send semantics; the copy frames preference only.
    await expect(
      page.getByText('Choose which events notify you in-app and by email.'),
    ).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Email' }).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: /send|test email|deliver|email now/i }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: /send|test email|deliver|email now/i }),
    ).toHaveCount(0)
    // Deliberately NOT clicking the switches: the preference write is a
    // core-capability mutation that would succeed (it is not the blocked
    // send), and flipping the seeded admin's preferences would leak state
    // across runs. The actual SEND path is worker-side and pinned by
    // dark-capability-enforcement.test.ts (cited in the header).

    // No browser-initiated mutation, and no Resend (or any external) call.
    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  // ── (e) Auto-publish absence: the reply UI offers manual actions only ──

  test('(e) the reply UI offers manual actions only — no auto-publish control anywhere (locked)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const PREFIX = 'e2e-dprom-'
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      externalId: `${PREFIX}review-${e2eRunId}`,
      rating: 4,
      text: 'Guests loved the quiet rooms and kind staff.',
      reviewerName: 'Dark Promo Reviewer',
    })
    const { inboxItemId } = await seedInboxItemForReview({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      reviewId,
    })

    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    await page.goto(`/inbox?itemId=${inboxItemId}`)
    await expect(page.getByText('Dark Promo Reviewer').first()).toBeVisible({
      timeout: 15_000,
    })
    // Manual actions exist (Draft / Submit for Approval on a fresh review;
    // Approve/Reject appear once a draft is submitted — all human-gated).
    await expect(page.getByRole('button', { name: 'Save Draft' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toBeVisible()
    // No auto-publish control or copy anywhere in the page.
    for (const role of ['button', 'link', 'switch', 'menuitem'] as const) {
      await expect(
        page.getByRole(role, {
          name: /auto-?publish|automatic publishing|publish automatically|autopilot/i,
        }),
      ).toHaveCount(0)
    }
    await expect(
      page.getByText(/auto-?publish|automatic publishing|publish automatically/i),
    ).toHaveCount(0)

    // Nothing was clicked → zero mutations; no external call.
    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })

  // ── (f) AI absence: no AI affordance in the app shell ───────────────

  test('(f) no AI/assistant/generate affordance in the app shell; no external call (locked)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)

    // signIn lands on /dashboard — the FLEET overview when earlier specs left
    // 2+ properties behind, or a redirect to the property deep-dive when only
    // the seeded one exists. The shell shape differs between the two, so wait
    // for either content heading (never the sidebar) — absence assertions must
    // not pass vacuously on an unrendered page — then scan the landing, the
    // property dashboard, and the inbox.
    await expect(
      page.getByRole('heading', { name: /^(dashboard|overview)$/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expectNoAiAffordance(page)

    await page.goto(`/properties/${seed.propertyId}`)
    await expect(page.getByText(seed.propertyName).first()).toBeVisible({
      timeout: 15_000,
    })
    await expectNoAiAffordance(page)

    await page.goto('/inbox')
    await expect(
      page
        .getByRole('heading', { name: /^inbox$/i })
        .or(page.getByText(/no inbox items/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 })
    await expectNoAiAffordance(page)

    log.assertNoMutations()
    log.assertNoExternalHosts([LOCKED_HOST])
  })
})

// ── Permissive posture (:3000): BLOCKED stays denied even allowlisted ──

test.describe('Critical: dark-context browser promotion (permissive posture — BLOCKED proof only)', () => {
  test.use({ baseURL: PERMISSIVE_ORIGIN })

  test('(b) portal create route redirects to unavailable and never mounts the form (permissive)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)
    await signIn(page, undefined, undefined, PERMISSIVE_ORIGIN)

    // portal.write is BLOCKED — never allowlistable — so even with
    // BETA_E2E_GLOBAL_CAPABILITIES on (:3000), the gate still denies.
    await page.goto(`/properties/${seed.propertyId}/portals/new`)
    await expectIntentionalUnavailable(page, 'Portals')
    expect(new URL(page.url()).host).toBe(PERMISSIVE_HOST)
    await expect(page.getByText('New Portal')).toHaveCount(0)
    await expect(
      page.getByText('Create a guest-facing portal page for this property.'),
    ).toHaveCount(0)

    log.assertNoMutations()
    log.assertNoExternalHosts([PERMISSIVE_HOST])
  })

  test('(c) guest public portal renders the same intentional unavailable UX (permissive)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const log = attachRequestLog(page)

    // portal.read is NOT in the :3000 allowlist either — the guest surface
    // denies identically there.
    await page.goto('/p/no-such-property/no-such-portal')
    await expectGuestPortalUnavailable(page)
    expect(new URL(page.url()).host).toBe(PERMISSIVE_HOST)

    log.assertNoMutations()
    log.assertNoExternalHosts([PERMISSIVE_HOST])
  })
})
