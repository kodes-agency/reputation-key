// Platform operator console (ADR 0063) — /operator.
//
// The seeded owner (OPS_OPERATOR_IDENTITIES in e2e/stack.env) creates an
// Organization without joining it and invites its first Account Admin; the
// invitee follows the emailed link, registers and lands signed in (ADR 0062);
// the console then reports one Account Admin and stops offering controls.
//
// Transitions verified:
//   signed-out visitor          → /login?redirect=/operator
//   non-operator (manager-one)  → HTTP 404, the console is not advertised
//   operator creates            → keyboard-only dialog, result, row listed ownerless
//   mail stub                   → one invitation mail, admin link, named Organization
//   invitee registers           → exactly one owner member; the operator is no member
//   console afterwards          → one Account Admin, no invite form, no invitee address
//   axe                         → the page, and the open dialog
//
// Every name and address carries the run id, so nothing needs cleaning up on
// the disposable stack. The operator's session is created by signIn moments
// before each change, inside the 30-minute recent-sign-in window.

import type { Page } from '@playwright/test'
import { test, expect } from '../../helpers/error-detection'
import { signIn, registerInvitedAccount } from '../../helpers/auth'
import { assertNoAxeViolations } from '../../helpers/a11y'
import { waitForHydration, clickWhenReady } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { dbQuery, e2eRunId } from '../../helpers/fixtures'
import { mailStubControl } from '../../fixtures/mail-stub'
import { deriveOrganizationSlug } from '../../../src/shared/domain/organization-slug'

const seed = requireE2eSeedState()
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

const ORGANIZATION_NAME = `E2E Provisioned ${e2eRunId}`
const ADMIN_EMAIL = `admin+${e2eRunId}@example.com`

async function openConsole(page: Page): Promise<void> {
  await page.goto('/operator')
  await waitForHydration(page)
  await expect(
    page.getByRole('heading', { name: 'Operator console', level: 1 }),
  ).toBeVisible()
}

/** The console's row for one Organization, found by its heading. */
function organizationRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name, level: 3 }),
  })
}

test.describe('Critical workflow: operator console', () => {
  test('a signed-out visitor is sent to sign in and back to the console', async ({
    page,
  }) => {
    await page.goto('/operator')
    await expect(page).toHaveURL(/\/login/)
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/operator')
  })

  test('a signed-in user who is not an operator gets Not Found', async ({ browser }) => {
    // manager-one holds a PropertyManager role in the seeded Organization:
    // a real workspace user, and still no operator.
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    const managerPage = await context.newPage()
    await signIn(
      managerPage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )

    const response = await managerPage.goto('/operator')

    expect(response?.status()).toBe(404)
    await expect(managerPage.getByText(/doesn't exist or may have moved/i)).toBeVisible()
    await expect(
      managerPage.getByRole('heading', { name: 'Operator console' }),
    ).toHaveCount(0)
    await context.close()
  })

  test('the operator creates an Organization, its invitee joins signed in, and the console shows one Account Admin', async ({
    page,
    browser,
  }) => {
    await mailStubControl.reset()
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await openConsole(page)
    await assertNoAxeViolations(page, 'operator console')

    // ── Keyboard: open with Enter, leave with Escape, focus returns ──
    const opener = page.getByRole('button', { name: /new organization/i })
    await opener.focus()
    await page.keyboard.press('Enter')
    // The dialog's name changes from "New Organization" to "Organization created",
    // so it is found by role alone: there is only ever one open.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()

    // ── Create it from the keyboard: name → slug → email → submit ──
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await assertNoAxeViolations(page, 'operator console: new organization dialog')

    const name = dialog.getByLabel('Organization name')
    const slug = dialog.getByLabel('Slug')
    const adminEmail = dialog.getByLabel("First Account Admin's email")
    await name.focus()
    await page.keyboard.type(ORGANIZATION_NAME)
    // The slug follows the name until it is edited.
    await expect(slug).toHaveValue(deriveOrganizationSlug(ORGANIZATION_NAME))
    await page.keyboard.press('Tab')
    await expect(slug).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(adminEmail).toBeFocused()
    await page.keyboard.type(ADMIN_EMAIL)
    await page.keyboard.press('Tab')
    const submit = dialog.getByRole('button', { name: /create and send invitation/i })
    await expect(submit).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(
      dialog.getByRole('heading', { name: 'Organization created' }),
    ).toBeVisible()
    await expect(dialog.getByText(ADMIN_EMAIL)).toBeVisible()
    await clickWhenReady(dialog.getByRole('button', { name: 'Done' }))
    await expect(dialog).toBeHidden()

    // ── The mail stub received one invitation, for the new Organization ──
    await expect
      .poll(async () =>
        (await mailStubControl.sends()).filter((send) => send.to === ADMIN_EMAIL),
      )
      .toHaveLength(1)
    const [invitation] = (await mailStubControl.sends()).filter(
      (send) => send.to === ADMIN_EMAIL,
    )
    expect(invitation?.subject).toContain('invited you to join')
    expect(invitation?.subject).toContain(ORGANIZATION_NAME)
    const invitationId = /\/accept-invitation\?id=([^"&\s]+)/.exec(
      invitation?.html ?? '',
    )?.[1]
    if (!invitationId) throw new Error('The invitation email carries no accept link')

    // ── The console lists it ownerless, with the open invitation ──
    const row = organizationRow(page, ORGANIZATION_NAME)
    await expect(row).toBeVisible()
    await expect(row.getByText('Needs an Account Admin')).toBeVisible()
    await expect(row.getByText(ADMIN_EMAIL, { exact: true })).toBeVisible()
    await expect(row.getByRole('form')).toBeVisible()
    await assertNoAxeViolations(page, 'operator console: ownerless Organization')

    // ── The invitee follows the link, registers, and lands signed in ──
    const inviteeContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const inviteePage = await inviteeContext.newPage()
    await registerInvitedAccount(inviteePage, invitationId, ADMIN_EMAIL)
    await inviteeContext.close()

    // The Organization has exactly one owner, and the operator is no member.
    const members = await dbQuery<{ email: string; role: string }>(
      `SELECT u.email, m.role
         FROM member m
         JOIN "user" u ON u.id = m."userId"
         JOIN organization o ON o.id = m."organizationId"
        WHERE o.name = $1`,
      [ORGANIZATION_NAME],
    )
    expect(members).toEqual([{ email: ADMIN_EMAIL, role: 'owner' }])

    // ── Afterwards the console shows one Account Admin and stops offering controls ──
    await openConsole(page)
    const administered = organizationRow(page, ORGANIZATION_NAME)
    await expect(administered).toBeVisible()
    await expect(administered.locator('dl')).toContainText(/Account Admins\s*1/)
    await expect(administered.getByText(/its admins manage invitations/i)).toBeVisible()
    await expect(administered.getByText('Needs an Account Admin')).toHaveCount(0)
    await expect(administered.getByRole('form')).toHaveCount(0)
    await expect(administered.getByRole('button')).toHaveCount(0)
    await expect(page.getByText(ADMIN_EMAIL, { exact: true })).toHaveCount(0)
  })
})
