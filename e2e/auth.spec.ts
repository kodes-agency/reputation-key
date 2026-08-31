// E2E: invitation-bound beta manager registration and login.
//
// Public registration and Organization creation cannot be reopened by an E2E
// override. The positive account journey therefore uses the same exact,
// email-bound manager invitation as beta.
//
// Identity mail is asserted against the fake outbox: exactly one verification
// send to the registrant. The real Resend API is unreachable in e2e
// (RESEND_BASE_URL pins the client at the stub), so the test follows the
// captured one-time link before sign-in. This proves delivery intent, content
// classification, and the required verification transition end to end.

import { test, expect } from './helpers/error-detection'
import { signIn, registerInvitedAccount } from './helpers/auth'
import { mailStubControl } from './fixtures/mail-stub'
import { cleanupE2eData, dbQuery, e2eRunId } from './helpers/fixtures'
import { requireE2eSeedState } from './helpers/seed-state'

const PREFIX = `e2e-register-${e2eRunId}`

test.describe('Authentication', () => {
  test.beforeEach(async () => {
    await mailStubControl.reset()
    const seed = requireE2eSeedState()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test.afterEach(async () => {
    const seed = requireE2eSeedState()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('create an invited manager account and sign in', async ({ page }) => {
    const seed = requireE2eSeedState()
    const suffix = crypto.randomUUID().slice(0, 8)
    const uniqueEmail = `${PREFIX}-${suffix}@example.com`
    const invitationId = `${PREFIX}-inv-${suffix}`
    const password = 'Password123!'
    await dbQuery(
      `INSERT INTO invitation
         (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ($1, $2, $3, 'admin', 'pending', NOW() + INTERVAL '1 day', $4, NOW())`,
      [invitationId, seed.organizationId, uniqueEmail, seed.managerUserId],
    )

    await registerInvitedAccount(page, invitationId, uniqueEmail, password)
    await expect(page.getByText(/account created/i)).toBeVisible()

    const authority = await dbQuery<{
      invitation_status: string
      member_role: string
      binding_organization_id: string
      binding_state: string
    }>(
      `SELECT i.status AS invitation_status,
              m.role AS member_role,
              b.organization_id AS binding_organization_id,
              b.state AS binding_state
         FROM invitation i
         JOIN "user" u ON LOWER(u.email) = LOWER(i.email)
         JOIN member m ON m."userId" = u.id AND m."organizationId" = i."organizationId"
         JOIN user_organization_bindings b ON b.user_id = u.id
        WHERE i.id = $1`,
      [invitationId],
    )
    expect(authority).toEqual([
      {
        invitation_status: 'accepted',
        member_role: 'admin',
        binding_organization_id: seed.organizationId,
        binding_state: 'active',
      },
    ])

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
