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
//   J3. two weeks live: on a Property whose Reception and Restaurant went live
//       20 days ago (Spa 8), the card offers the recommended number for the
//       month the rule names, and Use sets it in one tap: the goal is the
//       Property's "Monthly portal goal", stored as recommended, and its own
//       page is the card.
//
// Every Property here is the journey's own (prefix `e2e-pg-`, run id and retry
// in the slug). Expected days are read from the database clock in the
// Property's time zone (America/New_York), never written down. A run that
// crosses the Property's midnight at a month's end can see a month change
// between the read and the page; that flake is accepted (PLAN §3.6).
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { callServerFnGet, callServerFnGetExpectError } from '../../helpers/fixtures'
import { clickWhenReady, waitForHydration } from '../../helpers/interaction'
import {
  MONTHLY_PORTAL_GOALS,
  PORTAL_NAMES,
  localToday,
  seedPortalGoalProperty,
  seedPortalHistory,
  tearDownPortalGoalProperties,
} from '../../helpers/portal-goal-fixtures'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { recommendPortalGoal } from '../../../src/contexts/reporting/domain/goal-recommendation'
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

    // Every Portal went live today with its code made (issuing it publishes its
    // QR and NFC markers), in name order, and nothing is scanned yet.
    const rows = card
      .getByRole('list', { name: 'Portal readiness' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(PORTAL_NAMES.length)
    for (const [index, name] of PORTAL_NAMES.entries()) {
      const row = rows.nth(index)
      await expect(row).toContainText(name)
      await expect(row).toContainText('Live (done)')
      await expect(row).toContainText('Code made (done)')
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

  test('J3 two weeks live: the recommended number is set in one tap', async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j3',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, restaurant, spa] = portals
    if (!reception || !restaurant || !spa) throw new Error('E2E Portals are not seeded')
    // PLAN §3.7: Reception and Restaurant live 20 days ago with their codes a
    // day older, ratings on days −19…−6 (14 and 9) and scans (28 and 14); Spa
    // live 8 days ago, its code 17 days ago, 3 ratings on the last 3 days.
    const days = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, index) => from - index)
    const input = await seedPortalHistory(propertyId, [
      {
        portal: reception,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 6),
        scansDaysAgo: [...days(19, 6), ...days(19, 6)],
      },
      {
        portal: restaurant,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 11),
        scansDaysAgo: days(19, 6),
      },
      {
        portal: spa,
        liveDaysAgo: 8,
        codeDaysAgo: 17,
        ratingsDaysAgo: days(3, 1),
        scansDaysAgo: [],
      },
    ])
    // The number the card must offer, from the rule itself: this month through
    // the 20th (on top of what already counts), else the next. Both branches
    // assert what they draw.
    const recommendation = recommendPortalGoal(input)
    expect(recommendation.state).toBe('ready')
    const month = recommendation.defaultMonthKey
    const current = month === recommendation.months.current.key
    const ratings = recommendation.measures.portal_rating_count
    const offered = current ? ratings.fromToday : ratings.fullMonth.next
    if (!offered) throw new Error('The rule offers no number for this seed')
    const number = offered.aBitMore
    const monthName = formatMonthName(`${month}-15T12:00:00.000Z`)
    const firstDay = formatLocalDate(`${month}-01`, { year: false })
    const soFar = recommendation.monthToDate.portal_rating_count ?? 0

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const card = page.locator('#portal-goals [data-slot="portal-goal-card"]')
    await expect(card.getByText(`Recommended for ${monthName}`)).toBeVisible()
    await expect(card.getByText(String(number), { exact: true })).toBeVisible()
    await expect(
      card.getByText(
        'Spa is new. Its ratings count from day one, and it joins the number once it has 2 weeks.',
      ),
    ).toBeVisible()
    await expect(
      card.getByText(
        'Ask every guest, not only happy ones. Low and high ratings count the same.',
      ),
    ).toBeVisible()
    if (current) {
      await expect(
        card.getByText(
          `Counts from ${firstDay} · ${soFar} already ${soFar === 1 ? 'counts' : 'count'}.`,
        ),
      ).toBeVisible()
    } else {
      await expect(card.getByText(/^Counts from/u)).toHaveCount(0)
    }

    await clickWhenReady(card.getByRole('button', { name: `Use ${number}` }))
    await expect(
      page.getByText(`${monthName} goal set: ${number} private ratings`),
    ).toBeVisible()
    // The card now shows the goal it set, and offers nothing more.
    if (current) {
      await expect(card.getByText(`${soFar} of ${number} private ratings`)).toBeVisible()
    } else {
      await expect(
        card.getByText(`${monthName} · ${number} private ratings`),
      ).toBeVisible()
      await expect(
        card.getByText(new RegExp(`^Starts on ${firstDay}`, 'u')),
      ).toBeVisible()
    }
    await expect(card.getByRole('button', { name: /^Use /u })).toHaveCount(0)
    // It is listed once, as the card, and not again under "More portal goals".
    await expect(page.getByRole('heading', { name: 'More portal goals' })).toHaveCount(0)

    const listed = await callServerFnGet<{
      programs: ReadonlyArray<{
        program: { id: string; name: string; status: string }
        version: { metric: string; targetValue: number; targetSource: string | null }
        assignments: ReadonlyArray<{ subject: { kind: string } }>
      }>
    }>(page, {
      file: 'src/contexts/reporting/server/goal-programs.ts',
      exportName: 'listGoalPrograms',
      data: { propertyId },
    })
    expect(listed.programs).toHaveLength(1)
    const [goal] = listed.programs
    expect(goal).toMatchObject({
      program: { name: 'Monthly portal goal', status: current ? 'active' : 'scheduled' },
      version: {
        metric: 'portal_rating_count',
        targetValue: number,
        targetSource: 'recommended',
      },
      assignments: [{ subject: { kind: 'property' } }],
    })

    // Its own page is the card.
    await page.goto(`/properties/${propertyId}/goals/${goal?.program.id}`)
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals(\\?view=active)?#portal-goals$`, 'u'),
    )
    await expect(page.locator('[data-slot="portal-goal-card"]')).toBeVisible()
  })
})
