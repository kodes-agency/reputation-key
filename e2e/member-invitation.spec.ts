// E2E: Member invitation flow
// Targets the restored /settings/members route.

import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Member Invitation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('invite a new member and cancel invitation', async ({ page }) => {
    // Navigate to members settings
    await page.goto('/settings/members')
    await expect(page.getByRole('heading', { name: /members/i })).toBeVisible()

    // Open invite dialog
    await page.getByRole('button', { name: /invite member/i }).click()
    await expect(page.getByText(/invite a new member/i)).toBeVisible()

    // Fill invitation form
    const inviteEmail = `e2e-invite-${Date.now()}@example.com`
    await page.getByPlaceholder('colleague@example.com').fill(inviteEmail)

    // Select role — the role field is the first combobox in the form (the form
    // pre-selects a default role, so the "Select a role" placeholder isn't shown).
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /^staff$/i }).click()

    // Submit invitation
    await page.getByRole('button', { name: /send invitation/i }).click()

    // Invitation should appear in pending list
    await expect(page.getByText(inviteEmail)).toBeVisible()
    await expect(page.getByText(/pending/i)).toBeVisible()

    // Cancel the invitation via the confirm dialog (Radix AlertDialog, not a
    // native confirm). Open it, then confirm with the destructive action.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: /cancel invitation/i }).click()

    // Invitation should no longer be visible
    await expect(page.getByText(inviteEmail)).not.toBeVisible()
  })
})
