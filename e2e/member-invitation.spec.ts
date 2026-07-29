// E2E: Member invitation flow — /settings/members (BQR-5.2, hardened BQC-6.7).
//
// The fake outbox (e2e/fixtures/mail-stub.ts) proves the invitation email:
// exactly one invitation-classified send to the invitee. The placeholder-error
// tolerance is DELETED — the mail path runs against the stub, never Resend.

import { test, expect } from './helpers/error-detection'
import { signIn } from './helpers/auth'
import { waitForHydration, clickWhenReady } from './helpers/interaction'
import { mailStubControl } from './fixtures/mail-stub'

test.describe('Member Invitation', () => {
  test.beforeEach(async ({ page }) => {
    await mailStubControl.reset()
    await signIn(page)
  })

  test('invite a new member and cancel invitation', async ({ page }) => {
    await page.goto('/settings/members')
    await waitForHydration(page)
    await expect(page.getByRole('heading', { name: /^members$/i }).first()).toBeVisible()

    await clickWhenReady(page.getByRole('button', { name: /invite member/i }))
    await expect(page.getByText(/invite a new member/i)).toBeVisible()

    const inviteEmail = `e2e-invite-${Date.now()}@example.com`
    await page.getByPlaceholder('colleague@example.com').fill(inviteEmail)

    // Role field is the first combobox (default role may already be selected).
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^staff$/i }).click()

    await clickWhenReady(page.getByRole('button', { name: /send invitation/i }))

    // Invitation appears in the pending list — always now: the send cannot
    // fail closed on a placeholder provider key. exact: true scopes to the
    // table cell (the cancel dialog's title also contains the address).
    await expect(page.getByText(inviteEmail, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/pending/i).first()).toBeVisible()

    // Fake outbox: exactly one send, invitation classification (subject
    // '<inviter> invited you to join <org>'), correct recipient.
    await expect
      .poll(async () => (await mailStubControl.sends()).length, { timeout: 15_000 })
      .toBe(1)
    const [send] = await mailStubControl.sends()
    expect(send.to).toBe(inviteEmail)
    expect(send.subject).toContain('invited you to join')

    // Cancel via confirm dialog (Radix AlertDialog).
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: /cancel invitation/i }).click()
    // exact: true — while the dialog is open the address also appears in its
    // title; the row (and the whole pending section) must actually go away.
    await expect(page.getByText(inviteEmail, { exact: true })).not.toBeVisible()
  })
})
