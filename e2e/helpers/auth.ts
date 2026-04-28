// E2E auth helpers — shared login/registration utilities

import { expect, type Page } from '@playwright/test'

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'password123'

/** Sign in with the default test credentials. */
export async function signIn(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/(dashboard|properties)/)
}

/** Register a new account with a unique email. Returns the email used. */
export async function registerAccount(
  page: Page,
  email: string,
  password = 'Password123!',
) {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('E2E Test User')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Organization name').fill('E2E Test Org')
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  // Success renders on /register — no redirect. Wait for the success card.
  await expect(page.getByText(/account created/i)).toBeVisible()
  return email
}
