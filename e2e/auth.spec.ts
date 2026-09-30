// E2E: invitation-bound beta manager registration.
//
// Public registration and Organization creation cannot be reopened by an E2E
// override. The positive account journey therefore uses the same exact,
// email-bound manager invitation as beta.
//
// The stack runs with email verification required, as production does.
// Consuming the invitation verifies the address (ADR 0062): the invitee lands
// signed in, in the app, and no separate verification email is sent — the
// fake outbox must record none.

import { test, expect } from './helpers/error-detection'
import { registerInvitedAccount } from './helpers/auth'
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

  test('an invited manager creates an account and lands signed in, verified', async ({
    page,
  }) => {
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
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)

    const authority = await dbQuery<{
      invitation_status: string
      member_role: string
      organization_id: string
      email_verified: boolean
    }>(
      `SELECT i.status AS invitation_status,
              m.role AS member_role,
              m."organizationId" AS organization_id,
              u."emailVerified" AS email_verified
         FROM invitation i
         JOIN "user" u ON LOWER(u.email) = LOWER(i.email)
         JOIN member m ON m."userId" = u.id AND m."organizationId" = i."organizationId"
        WHERE i.id = $1`,
      [invitationId],
    )
    expect(authority).toEqual([
      {
        invitation_status: 'accepted',
        member_role: 'admin',
        organization_id: seed.organizationId,
        email_verified: true,
      },
    ])

    // The session is real: a fresh navigation into the app stays signed in.
    await page.goto('/properties')
    await expect(page).toHaveURL(/\/properties/)

    // No verification email: consuming the invitation was the verification.
    // Registration and the sign-in are both complete by now, so the outbox
    // has its final count. (Mail to other people, such as a notice to the
    // inviter, is not this journey's concern.)
    const sends = await mailStubControl.sends()
    expect(sends.filter((send) => send.to === uniqueEmail)).toEqual([])
    expect(sends.filter((send) => /verify your email/i.test(send.subject))).toEqual([])
  })
})
