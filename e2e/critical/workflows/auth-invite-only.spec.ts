// BQC-6.5 item 1 — invite-only authentication/session; no public
// registration route. Runs against the LOCKED server (:3001) where
// BETA_E2E_GLOBAL_CAPABILITIES is empty — the real beta posture.
//
// Transitions verified:
//   unauthenticated deep-link → /login (session gate)
//   /register                 → HTTP 404 (route absent)
//   seeded admin sign-in      → authenticated area (invite-only accounts work)

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { getUserByEmail } from '../../helpers/fixtures'

const LOCKED_ORIGIN = process.env.E2E_LOCKED_BASE_URL ?? 'http://localhost:3001'

test.use({ baseURL: LOCKED_ORIGIN })

test.describe('Critical workflow: invite-only auth (locked posture)', () => {
  test('unauthenticated deep-link redirects to /login', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/register is not found and does not create a user', async ({ page }) => {
    const response = await page.goto('/register')
    expect(response?.status()).toBe(404)
    expect(await getUserByEmail('public@example.com')).toBeNull()
  })

  test('seeded admin signs in (invite-only accounts authenticate)', async ({ page }) => {
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })
})
