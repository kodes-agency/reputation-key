// The manager UI is delivered by PR C; this journey joins it to the staff door.
import { randomUUID } from 'node:crypto'
import { test, expect } from '../helpers/error-detection'
import { signIn } from '../helpers/auth'
import { clickWhenReady, waitForHydration } from '../helpers/interaction'
import { requireE2eSeedState } from '../helpers/seed-state'
import {
  callServerFn,
  callServerFnGet,
  callServerFnGetExpectError,
  dbQuery,
  e2eRunId,
  waitFor,
} from '../helpers/fixtures'
import { mailStubControl } from '../fixtures/mail-stub'
import { seedPortalLookProperty } from '../helpers/portal-look-fixtures'

const seed = requireE2eSeedState()
const STAFF = 'src/contexts/identity/server/staff-accounts.ts'
const SELF = 'src/contexts/identity/server/staff-self.ts'
const REPORTING = 'src/contexts/reporting/server/staff-self-results.ts'
const suffix = `${e2eRunId}-${randomUUID().slice(0, 8)}`
const polly = `e2e-polly-${suffix}@example.com`
const sam = `e2e-sam-${suffix}@example.com`
const name = `Polly ${suffix}`

test('a staff invitation, a guest scan, closed manager routes and removal', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  await signIn(page)
  // A Property of its own with a published Portal to copy, made through the real
  // commands: the shared seed's Portal is a fixture snapshot, which Add staff
  // rightly refuses as having unpublished changes.
  const { propertyId } = await seedPortalLookProperty(
    page,
    suffix,
    test.info().retry,
    '#6366f1',
  )
  await page.goto(`/properties/${propertyId}/portals`)
  await waitForHydration(page)
  await clickWhenReady(page.getByRole('button', { name: 'Add staff', exact: true }))
  const add = page.getByRole('dialog', { name: 'Add staff', exact: true })
  await add.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await add.getByRole('textbox', { name: 'Email', exact: true }).fill(polly)
  await add.getByRole('button', { name: 'Add another' }).click()
  // Exercise the actual paste handler, without the operating system clipboard.
  await add
    .getByRole('textbox', { name: 'Name', exact: true })
    .nth(1)
    .evaluate((input, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
    }, `Sam ${suffix}\t${sam}`)
  await expect(
    add.getByRole('textbox', { name: 'Email', exact: true }).nth(1),
  ).toHaveValue(sam)
  await add.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(add.getByText('Invited', { exact: true })).toHaveCount(2)
  await add.getByRole('button', { name: 'Close', exact: true }).first().click()

  const staffContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const guestContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  try {
    await waitFor(
      async () => (await mailStubControl.sends()).some((send) => send.to === polly),
      { description: 'staff invitation delivered' },
    )
    const email = (await mailStubControl.sends()).find((send) => send.to === polly)
    const href = email?.html
      .match(/href="([^"]*accept-invitation[^"]*)"/u)?.[1]
      ?.replaceAll('&amp;', '&')
    if (!href) throw new Error('Staff invitation has no acceptance link')
    const staffPage = await staffContext.newPage()
    await staffPage.goto(href)
    await expect(staffPage.getByText('Staff', { exact: true })).toBeVisible()
    await expect(staffPage.getByText('None assigned yet')).toHaveCount(0)
    await staffPage.getByLabel('Full name', { exact: true }).fill(name)
    await staffPage.getByLabel('Password', { exact: true }).fill('StaffJourney123!')
    await staffPage
      .getByLabel('Confirm password', { exact: true })
      .fill('StaffJourney123!')
    await staffPage.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(staffPage).toHaveURL(/\/my(?:\?|$)/u)
    await expect(
      staffPage.getByRole('heading', { name: 'Before you start' }),
    ).toBeVisible()
    await expect(
      staffPage.getByRole('img', { name: 'Code for guests to scan' }),
    ).toHaveCount(0)
    await staffPage.getByRole('button', { name: 'Got it' }).click()
    await expect(
      staffPage.getByRole('img', { name: 'Code for guests to scan' }),
    ).toHaveAttribute('src', /^data:image\/png;base64,/u)
    await staffPage.reload()
    await expect(
      staffPage.getByRole('heading', { name: 'Before you start' }),
    ).toHaveCount(0)

    const home = await callServerFnGet<{ participations: { participationId: string }[] }>(
      staffPage,
      { file: SELF, exportName: 'getMyStaffHome' },
    )
    const participationId = home.participations[0]?.participationId
    if (!participationId) throw new Error('Accepted staff has no participation')
    const data = { participationId, period: 'today' }
    const before = await callServerFnGet<{ scans: number }>(staffPage, {
      file: REPORTING,
      exportName: 'getMyResults',
      data,
    })
    const code = await callServerFn<{ state: string; qr: string }>(staffPage, {
      file: SELF,
      exportName: 'getMyCode',
      data: { participationId },
    })
    const guest = await guestContext.newPage()
    await guest.goto(code.qr)
    await expect(guest.getByRole('radio').first()).toBeVisible()
    await staffPage.getByRole('tab', { name: 'My results', exact: true }).click()
    await staffPage.getByRole('radio', { name: 'Today', exact: true }).click()
    await waitFor(
      async () =>
        (
          await callServerFnGet<{ scans: number }>(staffPage, {
            file: REPORTING,
            exportName: 'getMyResults',
            data,
          })
        ).scans ===
        before.scans + 1,
      { description: 'guest scan reaches own staff results' },
    )
    await expect(staffPage.getByLabel('Your scans')).toContainText(
      String(before.scans + 1),
      { timeout: 45_000 },
    )
    for (const path of ['/dashboard', '/inbox', `/properties/${seed.propertyId}`]) {
      await staffPage.goto(path)
      await expect(staffPage).toHaveURL(/\/my(?:\?|$)/u)
    }
    const denied = await callServerFnGetExpectError(staffPage, {
      file: 'src/contexts/identity/server/organizations.query.ts',
      exportName: 'listMembers',
    })
    expect(denied.code).toBe('beta_role_inactive')

    await page.goto(`/properties/${propertyId}/people`)
    await waitForHydration(page)
    await page.getByRole('button', { name: `More actions for ${name}` }).click()
    await page.getByRole('menuitem', { name: /^Remove/u }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    const removed = await callServerFnGetExpectError(staffPage, {
      file: SELF,
      exportName: 'getMyStaffHome',
    })
    expect(removed.status).toBe(401)
    await guest.goto(code.qr)
    await expect(guest.getByRole('radio')).toHaveCount(0)
    await expect(guest.getByText(/page isn.t available/iu).first()).toBeVisible()
  } finally {
    await staffContext.close()
    await guestContext.close()
    // Remove any remaining invited person through the same manager command.
    const rows = await dbQuery<{ id: string }>(
      `SELECT s.id FROM staff_participations s JOIN staff_participants p ON p.id = s.staff_participant_id WHERE s.organization_id = $1 AND p.display_name IN ($2, $3) AND s.ended_at IS NULL`,
      [seed.organizationId, name, `Sam ${suffix}`],
    )
    for (const row of rows)
      await callServerFn(page, {
        file: STAFF,
        exportName: 'removeStaffMember',
        data: { participationId: row.id },
      })
  }
})
