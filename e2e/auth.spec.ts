// E2E: Authentication flows — register and login (full suite).
//
// BQC-6.7 posture: the register test is a full POSITIVE flow under the CI e2e
// capability override (BETA_E2E_GLOBAL_CAPABILITIES carries identity.register +
// organization.create on :3000) — gate ON here proves the capability mechanism
// works end-to-end; gate OFF (denied) is proven by the locked-posture critical
// spec (e2e/critical/workflows/auth-invite-only.spec.ts on :3001). The two
// pair to pin both sides of the capability.
//
// Identity mail is asserted against the fake outbox: exactly one verification
// send to the registrant. The real Resend API is unreachable in e2e
// (RESEND_BASE_URL pins the client at the stub), so the test follows the
// captured one-time link before sign-in. This proves delivery intent, content
// classification, and the required verification transition end to end.

import { test, expect } from './helpers/error-detection'
import { signIn, registerAccount } from './helpers/auth'
import { mailStubControl } from './fixtures/mail-stub'

test.describe('Authentication', () => {
  test.beforeEach(async () => {
    await mailStubControl.reset()
  })

  test('register a new account and sign in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${crypto.randomUUID().slice(0, 8)}@example.com`
    // registerAccount's default password differs from signIn's — pass one
    // explicitly so the post-registration sign-in uses the same credential.
    const password = 'Password123!'

    await registerAccount(page, uniqueEmail, password)
    await expect(page.getByText(/account created/i)).toBeVisible()

    // Fake outbox: exactly one send, verification classification (subject),
    // correct recipient. Poll — the send is awaited inside better-auth's
    // sign-up but the round trip may land just after the UI updates.
    await expect
      .poll(async () => (await mailStubControl.sends()).length, { timeout: 15_000 })
      .toBe(1)
    const [send] = await mailStubControl.sends()
    expect(send.to).toBe(uniqueEmail)
    expect(send.subject).toContain('Verify your email')

    const verificationHref = send.html.match(/href="([^"]+)"/)?.[1]
    expect(verificationHref).toBeTruthy()
    const verificationUrl = new URL(verificationHref!.replaceAll('&amp;', '&'))
    await page.goto(`${verificationUrl.pathname}${verificationUrl.search}`)

    await signIn(page, uniqueEmail, password)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })
})
