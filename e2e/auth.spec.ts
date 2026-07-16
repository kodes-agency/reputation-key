// E2E: Authentication flows — register and login (residual soft suite).

import { test, expect } from '@playwright/test'
import { signIn, registerAccount } from './helpers/auth'

test.describe('Authentication', () => {
  test('register a new account and sign in', async ({ page }) => {
    const uniqueEmail = `e2e-register-${crypto.randomUUID().slice(0, 8)}@example.com`

    await registerAccount(page, uniqueEmail)
    await expect(page.getByText(/account created/i)).toBeVisible()

    await signIn(page, uniqueEmail)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })

  test('sign in with existing credentials', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/(dashboard|properties|home)/)
  })
})
