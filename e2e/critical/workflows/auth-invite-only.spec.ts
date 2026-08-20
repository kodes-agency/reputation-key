// BQC-6.5 item 1 — invite-only authentication/session; forbidden public
// registration. Runs against the LOCKED server (:3001) where
// BETA_E2E_GLOBAL_CAPABILITIES is empty — the real beta posture: no
// identity.register / organization.create capability.
//
// Transitions verified:
//   unauthenticated deep-link → /login (session gate)
//   /register                 → /login (route gate) AND the register server
//                               fn denies at the RPC boundary (defense in depth)
//   seeded admin sign-in      → authenticated area (invite-only accounts work)

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { callServerFnExpectError, getUserByEmail } from '../../helpers/fixtures'

const LOCKED_ORIGIN = process.env.E2E_LOCKED_BASE_URL ?? 'http://localhost:3001'

test.use({ baseURL: LOCKED_ORIGIN })

test.describe('Critical workflow: invite-only auth (locked posture)', () => {
  test('unauthenticated deep-link redirects to /login', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/register redirects to /login and the register server fn denies', async ({
    page,
  }) => {
    await page.goto('/register')
    await expect(page).toHaveURL(/\/login/)

    // Defense in depth: even a direct RPC against the registration server fn
    // is denied (capability organization.create is OFF on this server). The
    // server shallow-serializes errors to clients (no internal code/message
    // leak), so the durable proof is: an error is returned AND no user row
    // is ever persisted.
    const error = await callServerFnExpectError(page, {
      file: 'src/contexts/identity/server/organizations.registration.ts',
      exportName: 'registerUserAndOrg',
      data: {
        name: 'Public User',
        email: 'public@example.com',
        password: 'Password123!',
        organizationName: 'Public Org',
      },
    })
    expect(error.message ?? '').toMatch(/error/i)
    expect(await getUserByEmail('public@example.com')).toBeNull()
  })

  test('seeded admin signs in (invite-only accounts authenticate)', async ({ page }) => {
    await signIn(page, undefined, undefined, LOCKED_ORIGIN)
    await expect(page).toHaveURL(/\/(dashboard|properties|home|inbox)/)
  })
})
