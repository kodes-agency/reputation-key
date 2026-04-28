// E2E: Member invitation flow

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

    // Select role
    await page
      .getByRole('combobox')
      .filter({ hasText: /select a role/i })
      .click()
    await page.getByRole('option', { name: /staff/i }).click()

    // Submit invitation
    await page.getByRole('button', { name: /send invitation/i }).click()

    // Invitation should appear in pending list
    await expect(page.getByText(inviteEmail)).toBeVisible()
    await expect(page.getByText(/pending/i)).toBeVisible()

    // Cancel the invitation
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: /cancel/i }).click()

    // Invitation should no longer be visible
    await expect(page.getByText(inviteEmail)).not.toBeVisible()
  })
})
