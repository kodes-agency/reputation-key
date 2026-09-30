// Members access (ADR 0033, amended 2026-10) — manager administration is the
// AccountAdmin's alone, and what a PropertyManager can work is a grant the
// AccountAdmin edits from Settings > Members.
//
// Transitions verified:
//   a. an AccountAdmin opens Edit access on a manager with no properties and
//      grants the seeded Property through the sheet: the Members table names it,
//      the manager then sees it in /properties and their Bell says "Your
//      property access changed"; revoking it through the same sheet takes it
//      away again (and leaves the seed as it found it)
//   b. a PropertyManager reads the member list and is offered no administration:
//      no Invite, no Invitations, no Change role / Edit access, no
//      Organization settings; the server refuses their invitation and access
//      commands with 403 (defence in depth behind the hidden controls)
//
// The Responsible switch in the sheet is covered by the component stories and
// the save-sequence unit tests: toggling it here would change the seeded
// Property's Responsible managers and fan out notices other specs do not expect.
// Demoting another AccountAdmin is covered by unit and integration tests; the
// seed has a single AccountAdmin.

import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { waitForHydration, clickWhenReady } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import {
  callServerFnExpectError,
  dbQuery,
  getNotificationsForUser,
  getUserByEmail,
  waitFor,
} from '../helpers/fixtures'

const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seed = requireE2eSeedState()

const ZERO_MANAGER_NAME = 'E2E Zero Property Manager'
const INVITATIONS_FILE = 'src/contexts/identity/server/organizations.invitations.ts'
const MEMBER_ACCESS_FILE = 'src/contexts/identity/server/organizations.member-access.ts'

/** Leave manager-zero with no grant, however the test ended. */
async function revokeZeroManagerGrants() {
  const zero = await getUserByEmail(seed.zeroPropertyManagerEmail)
  if (!zero) return
  await dbQuery(
    `UPDATE property_access_grant
        SET revoked_at = now(), revoke_reason = 'superseded'
      WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [seed.organizationId, zero.id],
  )
}

test.describe('Critical workflow: Members access', () => {
  test.beforeEach(revokeZeroManagerGrants)
  test.afterEach(revokeZeroManagerGrants)

  test('an Account Admin grants a manager a property through the sheet, the manager sees it and is told, and a revoke takes it away', async ({
    page,
    browser,
  }) => {
    await signIn(page, undefined, undefined, BASE_ORIGIN, '/settings/members')
    await waitForHydration(page)

    const managerRow = page
      .getByRole('row')
      .filter({ hasText: seed.zeroPropertyManagerEmail })
    // The manager has no property yet, and the table says so.
    await expect(managerRow.getByText('No properties')).toBeVisible()
    await expect(managerRow.getByText('Sees an empty app')).toBeVisible()

    // Grant the seeded Property through the sheet.
    await clickWhenReady(
      managerRow.getByRole('button', { name: `Edit access for ${ZERO_MANAGER_NAME}` }),
    )
    const sheet = page.getByRole('dialog', {
      name: `Edit access for ${ZERO_MANAGER_NAME}`,
    })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Save access' })).toBeDisabled()
    await sheet.getByRole('checkbox', { name: seed.propertyName, exact: true }).click()
    await expect(sheet.getByText(/^Gives .+ access to /)).toBeVisible()
    await expect(sheet.getByText(/^We tell .+ in the app and by email\.$/)).toBeVisible()
    await clickWhenReady(sheet.getByRole('button', { name: 'Save access' }))
    await expect(page.getByText('Access updated')).toBeVisible()
    await expect(sheet).toHaveCount(0)
    await expect(managerRow.getByText(seed.propertyName)).toBeVisible()
    await expect(managerRow.getByText('No properties')).toHaveCount(0)

    // The manager now works that Property and is told in the app.
    const zero = await getUserByEmail(seed.zeroPropertyManagerEmail)
    if (!zero) throw new Error('the seeded zero-property manager is missing')
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    try {
      const managerPage = await context.newPage()
      await signIn(
        managerPage,
        seed.zeroPropertyManagerEmail,
        seed.boundedManagerPassword,
        BASE_ORIGIN,
      )
      await managerPage.goto('/properties')
      await expect(managerPage.getByText(seed.propertyName).first()).toBeVisible({
        timeout: 15_000,
      })

      // A mandatory Organization notice: written by the worker once the fact is
      // dispatched, so wait for the row rather than assuming it is instant.
      await waitFor(
        async () =>
          (await getNotificationsForUser(zero.id)).find(
            (row) => row.type === 'account.organization_property_access_changed',
          ) ?? null,
        {
          timeoutMs: 30_000,
          description: 'property-access notice for the manager',
        },
      )
      // The bell's feed head refreshes on a 30 s poll, so reload to be sure the
      // row the DB assertion just confirmed has reached the client.
      await managerPage.reload()
      await waitForHydration(managerPage)
      await clickWhenReady(
        managerPage.getByRole('button', { name: /notifications/i }).first(),
      )
      const popover = managerPage.locator('[data-radix-popper-content-wrapper]').first()
      await expect(popover.getByText('Your property access changed').first()).toBeVisible(
        {
          timeout: 10_000,
        },
      )

      // Revoke it again through the same sheet.
      await page.reload()
      await waitForHydration(page)
      await clickWhenReady(
        managerRow.getByRole('button', { name: `Edit access for ${ZERO_MANAGER_NAME}` }),
      )
      await expect(sheet).toBeVisible()
      const propertyBox = sheet.getByRole('checkbox', {
        name: seed.propertyName,
        exact: true,
      })
      await expect(propertyBox).toBeChecked()
      await propertyBox.click()
      await expect(sheet.getByText(/^Removes access to .+ loses its Inbox/)).toBeVisible()
      await clickWhenReady(sheet.getByRole('button', { name: 'Save access' }))
      await expect(page.getByText('Access updated')).toBeVisible()
      await expect(managerRow.getByText('No properties')).toBeVisible()

      // The manager no longer works it.
      await managerPage.goto('/dashboard')
      await expect(managerPage.getByText('No properties yet')).toBeVisible({
        timeout: 15_000,
      })
      await expect(managerPage.getByText(seed.propertyName, { exact: true })).toHaveCount(
        0,
      )
    } finally {
      await context.close()
    }
  })

  test('a Property Manager reads the member list and is offered no administration', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    try {
      const page = await context.newPage()
      await signIn(
        page,
        seed.onePropertyManagerEmail,
        seed.boundedManagerPassword,
        BASE_ORIGIN,
        '/settings/members',
      )
      await waitForHydration(page)

      // The page is readable: the member list is what Inbox assignment and
      // Responsible managers read.
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        page.getByText(seed.managerName, { exact: true }).first(),
      ).toBeVisible()

      // …but nothing on it administers people.
      await expect(page.getByRole('button', { name: /invite member/i })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /change role/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /edit access/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^remove/i })).toHaveCount(0)
      await expect(page.getByRole('columnheader', { name: 'Properties' })).toHaveCount(0)
      // The Organization settings item is gone from the settings navigation.
      await expect(page.locator('a[href="/settings/organization"]')).toHaveCount(0)

      // The server refuses what the page no longer offers.
      const resend = await callServerFnExpectError(page, {
        file: INVITATIONS_FILE,
        exportName: 'resendInvitation',
        data: { invitationId: 'e2e-not-an-invitation' },
      })
      expect(resend.status).toBe(403)
      const access = await callServerFnExpectError(page, {
        file: MEMBER_ACCESS_FILE,
        exportName: 'setMemberPropertyAccess',
        data: {
          memberId: 'e2e-not-a-member',
          grantPropertyIds: [seed.propertyId],
          revokePropertyIds: [],
        },
      })
      expect(access.status).toBe(403)
    } finally {
      await context.close()
    }
  })
})
