// The Monthly portal goal (ADR 0068, PLAN §3.7): one recommended monthly number
// for a Property's Portals, set from the Portal goals section of the Goals page.
// Each PR of the build appends its journey here, in order.
//
// Journeys:
//   J1. the first weeks: on a Property whose three Portals went live today, the
//       card shows each Portal's steps, the month so far, and the day the
//       recommended number is ready (two weeks from now). The Portal goals sit
//       below the Google rating goal and share nothing with it.
//   J2. manager-one (granted the Property) reads the card; manager-zero (no
//       grant: `scope_denied`) and the staff Member (`beta_role_inactive`) are
//       refused it.
//
// Every Property here is the journey's own (prefix `e2e-pg-`, run id and retry
// in the slug). Expected days are read from the database clock in the
// Property's time zone (America/New_York), never written down. A run that
// crosses the Property's midnight at a month's end can see a month change
// between the read and the page; that flake is accepted (PLAN §3.6).
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { callServerFnGetExpectError } from '../../helpers/fixtures'
import { waitForHydration } from '../../helpers/interaction'
import {
  MONTHLY_PORTAL_GOALS,
  PORTAL_NAMES,
  localToday,
  seedPortalGoalProperty,
  tearDownPortalGoalProperties,
} from '../../helpers/portal-goal-fixtures'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { addLocalDays } from '../../../src/contexts/reporting/domain/local-days'
import { formatLocalDate, formatMonthName } from '../../../src/lib/format'

const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seed = requireE2eSeedState()

test.describe('Critical workflow: the Monthly portal goal', () => {
  test.describe.configure({ mode: 'serial' })

  const seeded: string[] = []

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    const page = await context.newPage()
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    await tearDownPortalGoalProperties(page, seeded)
    await context.close()
  })

  test("J1 the first weeks: each portal's steps and the day the number is ready", async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId } = await seedPortalGoalProperty(page, 'j1', testInfo.retry)
    seeded.push(propertyId)
    const today = await localToday(propertyId)

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)

    // The Google rating goal first, then the Portal goals, apart.
    for (const name of ['Google rating goal', 'Portal goals']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    const titles = await page.getByRole('heading', { level: 2 }).allTextContents()
    expect(titles.indexOf('Google rating goal')).toBeGreaterThanOrEqual(0)
    expect(titles.indexOf('Portal goals')).toBeGreaterThan(
      titles.indexOf('Google rating goal'),
    )

    const section = page.locator('#portal-goals')
    await expect(
      section.getByText('How many private ratings your portals bring in each month.'),
    ).toBeVisible()
    const card = section.locator('[data-slot="portal-goal-card"]')
    await expect(
      card.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
    ).toBeVisible()
    await expect(card.getByText('Getting your portals ready')).toBeVisible()

    // Every Portal went live today, in name order, and nothing is scanned yet.
    const rows = card
      .getByRole('list', { name: 'Portal readiness' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(PORTAL_NAMES.length)
    for (const [index, name] of PORTAL_NAMES.entries()) {
      const row = rows.nth(index)
      await expect(row).toContainText(name)
      await expect(row).toContainText('Live (done)')
      await expect(row).toContainText('First scan (not yet)')
    }
    // A code made today is far from the 14 days its hint waits for.
    await expect(card.getByText(/No scan in the/u)).toHaveCount(0)

    const month = formatMonthName(`${today.slice(0, 7)}-15T12:00:00.000Z`)
    await expect(
      card.getByText(`So far in ${month}: 0 private ratings · 0 scans`),
    ).toBeVisible()
    // Live today is no live day of the basis yet, so 14 more days.
    const readyOn = formatLocalDate(addLocalDays(today, 14), { year: false })
    await expect(
      card.getByText(
        `Your recommended number is ready on ${readyOn}, after 2 weeks live.`,
      ),
    ).toBeVisible()
    // No number is offered before then, and no way to the old form from the card.
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(card.getByRole('link', { name: /goal/iu })).toHaveCount(0)
    // The way to other Portal goals stays, as one quiet link.
    await expect(
      section.getByRole('link', { name: 'Add a portal goal' }),
    ).toHaveAttribute('href', `/properties/${propertyId}/goals/new`)
  })

  test('J2 manager-zero and the staff Member are refused the monthly portal goal', async ({
    browser,
  }) => {
    const propertyId = seeded[0]
    expect(propertyId).toBeTruthy()

    // manager-one holds the Property's grant: the card is theirs to read.
    const oneContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const onePage = await oneContext.newPage()
    await signIn(
      onePage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await onePage.goto(`/properties/${propertyId}/goals`)
    await expect(
      onePage
        .locator('[data-slot="portal-goal-card"]')
        .getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
    ).toBeVisible()
    await oneContext.close()

    // Each refused for its own reason: no grant on the Property, and a role the
    // closed beta keeps out of interactive work.
    for (const [email, password, refusal] of [
      [seed.zeroPropertyManagerEmail, seed.boundedManagerPassword, 'scope_denied'],
      [seed.staffEmail, seed.staffPassword, 'beta_role_inactive'],
    ] as const) {
      const context = await browser.newContext({ baseURL: BASE_ORIGIN })
      const refused = await context.newPage()
      await signIn(refused, email, password, BASE_ORIGIN)
      const error = await callServerFnGetExpectError(refused, {
        file: MONTHLY_PORTAL_GOALS,
        exportName: 'getMonthlyPortalGoalCard',
        data: { propertyId },
      })
      expect(error.code).toBe(refusal)
      await context.close()
    }
  })
})
