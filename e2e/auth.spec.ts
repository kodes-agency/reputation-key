// E2E: Authentication flows — register and login

import { test, expect } from '@playwright/test'
import { signIn, registerAccount } from './helpers/auth'

test.describe('Authentication', () => {
  test('register a new account and sign in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@example.com`

    // Register
    await registerAccount(page, uniqueEmail)

    // Should show login page with success message
    await expect(page.getByText(/account created/i)).toBeVisible()

    // Sign in with new credentials
    await signIn(page, uniqueEmail)

    // Should be on dashboard or properties
    await expect(
      page.getByRole('heading', { name: /properties|dashboard/i }),
    ).toBeVisible()
  })

  test('sign in with existing credentials', async ({ page }) => {
    await signIn(page)

    // Should redirect to authenticated area
    await expect(page).toHaveURL(/\/(dashboard|properties)/)
  })
})
