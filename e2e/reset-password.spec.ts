// E2E: Password reset request flow (BQR-5.2, hardened BQC-6.7).
//
// THIS SPEC CONSUMES A RECOVERY CREDENTIAL, so it runs against a disposable
// per-run account and must never point at `seed.email`.
// `revokeSessionsOnPasswordReset` (src/shared/auth/auth.ts) deletes EVERY
// session row for the target user, in every browser context. The `full`
// project is fullyParallel, so resetting the shared seeded manager revoked the
// sessions of whatever else was signed in as it at that moment — navigation,
// staff-assignment and accessibility each failed that way, redirected to
// /login mid-test, and which ones failed changed from run to run. The product
// behaviour is correct and must not change; only the account under test moves.
// AuthCard titles are divs — assert by text, not heading role.
//
// The fake outbox (e2e/fixtures/mail-stub.ts) proves the reset email: exactly
// one reset-classified send to the requested address. The placeholder-error
// tolerance is DELETED — the mail path runs against the stub, never Resend.

import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/error-detection'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { mailStubControl } from './fixtures/mail-stub'
import { registerInvitedAccount } from './helpers/auth'
import { requireE2eSeedState } from './helpers/seed-state'
import { cleanupE2eData, dbQuery } from './helpers/fixtures'

const PREFIX = 'e2e-reset'

// Extract by URL CONTRACT, not by label adjacency. The old regex required the
// anchor's text to be literally `Reset Password` immediately before `</a>`,
// which coupled the test to one hand-rolled template; react-email's Button
// wraps its label in nested markup, so it stopped matching a link that was
// present and correct.
//
// Match on the route only. better-auth mints the reset URL itself and carries
// the token as a PATH segment (`/api/auth/reset-password/<token>?callbackURL=…`),
// so requiring a `token=` query parameter would be asserting our own guess
// about someone else's URL shape rather than the contract that matters.
function extractResetLink(html: string): string {
  const href = [...html.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1].replaceAll('&amp;', '&'))
    .find((url) => url.includes('reset-password'))
  if (!href) throw new Error('Reset email does not link to the reset-password route')
  return href
}

test.describe('Password Reset', () => {
  test.beforeEach(async () => {
    await mailStubControl.reset()
  })

  test.afterEach(async () => {
    const seed = requireE2eSeedState()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('resets the password through the emailed link', async ({ page, context }) => {
    const seed = requireE2eSeedState()
    const suffix = randomUUID().slice(0, 8)
    const testEmail = `${PREFIX}-${suffix}@example.com`
    const invitationId = `${PREFIX}-inv-${suffix}`
    const originalPassword = 'Password123!'
    const newPassword = 'NewPassword456!'
    await dbQuery(
      `INSERT INTO invitation
         (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ($1, $2, $3, 'admin', 'pending', NOW() + INTERVAL '1 day', $4, NOW())`,
      [invitationId, seed.organizationId, testEmail, seed.managerUserId],
    )
    await registerInvitedAccount(page, invitationId, testEmail, originalPassword)
    // The seeded manager this spec used to borrow is emailVerified; a freshly
    // invited account is not, and an unverified account cannot complete a fresh
    // sign-in — which would fail the last step for a reason that has nothing to
    // do with password recovery.
    await dbQuery('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [
      testEmail,
    ])
    // Registration sends its own mail; the outbox assertion below counts only
    // the reset.
    await mailStubControl.reset()
    // A guest who forgot their password is not signed in. Registration leaves
    // an active session, and recovering while holding one is not the journey
    // under test.
    await context.clearCookies()

    await page.goto('/reset-password')
    await waitForHydration(page)
    await expect(page.getByText(/reset your password/i)).toBeVisible()

    await page.getByLabel('Email').fill(testEmail)
    await clickWhenReady(page.getByRole('button', { name: /send reset link/i }))

    // Success card (AuthCard title is a div) — always renders now: the send
    // cannot fail closed on a placeholder provider key.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(testEmail)).toBeVisible()

    // Fake outbox: exactly one send, reset classification (subject), correct
    // recipient.
    await expect
      .poll(async () => (await mailStubControl.sends()).length, { timeout: 15_000 })
      .toBe(1)
    const [send] = await mailStubControl.sends()
    expect(send.to).toBe(testEmail)
    expect(send.subject).toContain('Reset your password')

    const resetLink = extractResetLink(send.html)
    await page.goto(resetLink)
    await expect(page).toHaveURL(/\/reset-password\?token=[^&]+$/)
    await expect(page.getByText(/choose a new password/i)).toBeVisible()

    await page.getByLabel('New password').fill(newPassword)
    await page.getByLabel('Confirm password').fill(newPassword)
    await clickWhenReady(page.getByRole('button', { name: /save new password/i }))

    await expect(page.getByText(/password updated/i)).toBeVisible()

    await page
      .getByRole('main')
      .getByRole('link', { name: /^sign in$/i })
      .click()
    await waitForHydration(page)
    await page.getByLabel('Email').fill(testEmail)
    await page.getByLabel('Password').fill(newPassword)
    await clickWhenReady(page.getByRole('button', { name: /^sign in$/i }))
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })
})
