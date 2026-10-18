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
//   J1 (continued). On J1's Property, "Set my own number" opens the set sheet
//       with the box empty and "Set goal" disabled; 12 typed enables "Set 12
//       for {month}"; Cancel closes it with nothing set.
//   J5. the running month: a goal set for this month through the server
//       function shows the governed figure against its number, what is left
//       to go with the days left, "below pace" exactly when `goalPace` says
//       behind, the bar's sentence, and each Portal's count in name order.
//   J6. the goal page: "View details" on the card opens `/goals/portals`, with
//       what it counts, the tiles, each Portal's count with the total, the
//       month on its strip, and the change log (the set, as recommended, and
//       each Portal going live); both themes pass axe.
//   J7. change from next month, then stop: on the goal page, "Change number",
//       "From {next month} 1" and a new number set from next month say so in a
//       toast; Stop asks first, stops, and the Goals page's card says the goal
//       was stopped today, that this month still counts to its last day, and
//       offers a goal from next month. A goal is never stopped and set again
//       in the same month here.
//   J11. all monthly results: once a Portal goal's month has closed and another
//       has ended, the Portal goals section's foot opens `/goals/portal-results`:
//       the closed month's result in plain words, and the ended goal with the
//       day it ended, where "Ended portal goals (1)" lands and hands its title
//       the focus; both themes pass axe.
//   J12. History belongs to the Google section (P-7a): on `?view=history` the
//       Active / History tabs sit inside the one region named "Google rating
//       goal", which shows its own History; the Portal goals below it keep the
//       card, the goal not ended and the way to the ended one, which is not
//       listed on the Goals page, exactly as on Active; the History view passes
//       axe.
//   J13. a goal for one portal, one click deeper: "Add a portal goal" at the
//       foot of the section opens the sheet in place; Reception's own number
//       (the rule on its own rate, worked out with the pure rule) is set for
//       the month offered and listed under "More portal goals"; the sheet
//       passes axe; and the old `/goals/new` opens it on the goal page.
//
// Every Property here is the journey's own (prefix `e2e-pg-`, run id and retry
// in the slug). Expected days are read from the database clock in the
// Property's time zone (America/New_York), never written down. A run that
// crosses the Property's midnight at a month's end can see a month change
// between the read and the page; that flake is accepted (PLAN §3.6).
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import {
  callServerFn,
  callServerFnGet,
  callServerFnGetExpectError,
} from '../../helpers/fixtures'
import { assertNoAxeViolations } from '../../helpers/a11y'
import {
  clickWhenReady,
  dismissToasts,
  waitForHydration,
} from '../../helpers/interaction'
import {
  MONTHLY_PORTAL_GOALS,
  PORTAL_NAMES,
  closePortalGoalMonth,
  localToday,
  nextMonthKey,
  seedPortalGoalProperty,
  seedPortalHistory,
  tearDownPortalGoalProperties,
} from '../../helpers/portal-goal-fixtures'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  recommendPortalGoal,
  subjectRecommendation,
} from '../../../src/contexts/reporting/domain/goal-recommendation'
import { GOAL_CURRENT_MONTH_CUTOFF_DAY } from '../../../src/contexts/reporting/domain/goal-start'
import { goalMonthDays, goalPace } from '../../../src/contexts/reporting/domain/goal-pace'
import { addLocalDays } from '../../../src/contexts/reporting/domain/local-days'
import { calendarPeriodRange } from '../../../src/shared/domain/period-range'
import {
  formatLocalDate,
  formatMonthName,
  formatMonthYear,
} from '../../../src/lib/format'

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
    // No number is offered before then (only a number of one's own), and no way
    // to the old form from the card.
    await expect(card.getByRole('button')).toHaveText(['Set my own number'])
    await expect(card.getByRole('link', { name: /goal/iu })).toHaveCount(0)
    // The way to other Portal goals stays, as one quiet door that opens in
    // place: three live Portals have something to add (PG-20).
    await expect(section.getByRole('button', { name: 'Add a portal goal' })).toBeVisible()
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

    // Its old page address opens the goal's own page.
    await page.goto(`/properties/${propertyId}/goals/${goal?.program.id}`)
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals/portals$`, 'u'),
    )
    await expect(
      page.getByRole('heading', { level: 1, name: 'Monthly portal goal' }),
    ).toBeVisible()
  })

  test("J1 (continued) a number of one's own: the sheet starts empty, and 12 can be set", async ({
    page,
  }) => {
    const propertyId = seeded[0]
    if (!propertyId) throw new Error("J1's Property is not seeded")
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const today = await localToday(propertyId)
    // The sheet opens on the month the card would offer: this one through the
    // 20th local day, else the next. Both branches assert what they draw.
    const [year = 0, month = 1, day = 1] = today.split('-').map(Number)
    const opensOn =
      day <= GOAL_CURRENT_MONTH_CUTOFF_DAY
        ? today.slice(0, 7)
        : month === 12
          ? `${year + 1}-01`
          : `${year}-${String(month + 1).padStart(2, '0')}`
    const monthName = formatMonthName(`${opensOn}-15T12:00:00.000Z`)

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const card = page.locator('#portal-goals [data-slot="portal-goal-card"]')
    await clickWhenReady(card.getByRole('button', { name: 'Set my own number' }))

    const sheet = page.getByRole('dialog', { name: 'Monthly portal goal' })
    const box = sheet.getByRole('spinbutton')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('')
    await expect(sheet.getByRole('button', { name: 'Set goal' })).toBeDisabled()
    await expect(
      sheet.getByText(/^No recommendation yet\. Your number is ready on /u),
    ).toBeVisible()
    await box.fill('12')
    await expect(
      sheet.getByRole('button', { name: `Set 12 for ${monthName}` }),
    ).toBeEnabled()

    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toHaveCount(0)
    // Nothing was set: the card still shows the first weeks, and the focus is
    // back on the door.
    await expect(card.getByText('Getting your portals ready')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Set my own number' })).toBeFocused()
  })

  test('J5 the running month: count, to go, days left and each portal in name order', async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j5',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, restaurant, spa] = portals
    if (!reception || !restaurant || !spa) throw new Error('E2E Portals are not seeded')
    // Ratings up to yesterday, never later today: a reading still ahead of the
    // clock would be in the governed month and not yet in the Portals' counts.
    const days = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, index) => from - index)
    const input = await seedPortalHistory(propertyId, [
      {
        portal: reception,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 1),
        scansDaysAgo: days(19, 6),
      },
      {
        portal: restaurant,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(10, 1),
        scansDaysAgo: [],
      },
      {
        portal: spa,
        liveDaysAgo: 8,
        codeDaysAgo: 17,
        ratingsDaysAgo: days(3, 1),
        scansDaysAgo: [],
      },
    ])
    // Everything expected is worked out by the rules themselves.
    const recommendation = recommendPortalGoal(input)
    const month = recommendation.months.current.key
    const soFar = recommendation.monthToDate.portal_rating_count ?? 0
    const target =
      recommendation.measures.portal_rating_count.fromToday?.aBitMore ?? soFar + 10
    const period = calendarPeriodRange(input.now, input.timezone, 'monthly')
    const { daysLeft } = goalMonthDays(period, input.now, input.timezone)
    const left = daysLeft + 1 <= 1 ? 'last day' : `${daysLeft + 1} days left`
    const pace = goalPace({
      metric: 'portal_rating_count',
      value: soFar,
      target,
      period,
      now: input.now,
      timezone: input.timezone,
    })
    const monthName = formatMonthName(`${month}-15T12:00:00.000Z`)

    // Its own Property sets this month's goal straight through the server function.
    await callServerFn(page, {
      file: MONTHLY_PORTAL_GOALS,
      exportName: 'setMonthlyPortalGoal',
      data: {
        propertyId,
        metric: 'portal_rating_count',
        targetValue: target,
        startMonth: month,
        targetSource: 'own',
      },
    })

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const card = page.locator('#portal-goals [data-slot="portal-goal-card"]')
    await expect(card.getByText(`${soFar} of ${target}`, { exact: true })).toBeVisible()
    await expect(card.getByText('private ratings', { exact: true })).toBeVisible()
    await expect(
      card.getByText(`${target - soFar} to go · ${left}`, { exact: true }),
    ).toBeVisible()
    // "below pace" exactly when the rule says behind; never "on pace".
    await expect(card.getByText('below pace', { exact: true })).toHaveCount(
      pace.state === 'behind' ? 1 : 0,
    )
    await expect(card.getByText(/on pace/u)).toHaveCount(0)
    await expect(
      card.getByRole('progressbar', { name: `Private ratings in ${monthName}` }),
    ).toHaveAttribute(
      'aria-valuetext',
      [`${soFar} of ${target} private ratings`, left]
        .concat(pace.state === 'behind' ? ['below pace'] : [])
        .join(', '),
    )

    // Each Portal's count of the month, in name order, never by count.
    const rows = card
      .getByRole('list', { name: 'From your portals' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(PORTAL_NAMES.length)
    for (const [index, name] of PORTAL_NAMES.entries()) {
      const facts = recommendation.portals.find((portal) => portal.name === name)
      if (!facts) throw new Error(`The rule lists no ${name}`)
      const row = rows.nth(index)
      await expect(row.locator('span').first()).toHaveText(name)
      await expect(row.locator('span').last()).toHaveText(
        String(facts.monthToDate.portal_rating_count),
      )
    }
    await expect(card.getByText('Other portals')).toHaveCount(0)
  })
  test("J6 the goal page: tiles, each portal's count, the change log; both themes pass axe", async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j6',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, restaurant, spa] = portals
    if (!reception || !restaurant || !spa) throw new Error('E2E Portals are not seeded')
    // Ratings up to yesterday, never later today, as in J5.
    const days = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, index) => from - index)
    const input = await seedPortalHistory(propertyId, [
      {
        portal: reception,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 1),
        scansDaysAgo: days(19, 6),
      },
      {
        portal: restaurant,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(10, 1),
        scansDaysAgo: [],
      },
      {
        portal: spa,
        liveDaysAgo: 8,
        codeDaysAgo: 17,
        ratingsDaysAgo: days(3, 1),
        scansDaysAgo: [],
      },
    ])
    const recommendation = recommendPortalGoal(input)
    const month = recommendation.months.current.key
    const soFar = recommendation.monthToDate.portal_rating_count ?? 0
    // This month's recommended number, set as recommended; the log says so.
    const recommended = recommendation.measures.portal_rating_count.fromToday?.aBitMore
    const target = recommended ?? soFar + 10
    const monthName = formatMonthName(`${month}-15T12:00:00.000Z`)
    const today = await localToday(propertyId)
    const dayOf = (daysAgo: number) =>
      formatLocalDate(addLocalDays(today, -daysAgo), { year: false })
    await callServerFn(page, {
      file: MONTHLY_PORTAL_GOALS,
      exportName: 'setMonthlyPortalGoal',
      data: {
        propertyId,
        metric: 'portal_rating_count',
        targetValue: target,
        startMonth: month,
        targetSource: recommended === undefined ? 'own' : 'recommended',
      },
    })

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const card = page.locator('#portal-goals [data-slot="portal-goal-card"]')
    await clickWhenReady(card.getByRole('link', { name: 'View details' }))
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals/portals$`, 'u'),
    )
    await waitForHydration(page)

    await expect(
      page.getByRole('heading', { level: 1, name: 'Monthly portal goal' }),
    ).toBeVisible()
    await expect(
      page.getByText(/^Private ratings from all 3 portals at .+\.$/u),
    ).toBeVisible()
    // The tiles: this month so far, and no goal the month before.
    const tiles = page.locator('[data-slot="metric-strip"]')
    await expect(tiles.getByText(`${soFar} of ${target}`, { exact: true })).toBeVisible()
    await expect(tiles.getByText('No goal yet', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: `${monthName} so far` }),
    ).toBeVisible()

    // Each Portal's count in name order, then the total.
    const rows = page
      .getByRole('list', { name: 'From your portals' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(PORTAL_NAMES.length + 1)
    for (const [index, name] of PORTAL_NAMES.entries()) {
      const facts = recommendation.portals.find((portal) => portal.name === name)
      if (!facts) throw new Error(`The rule lists no ${name}`)
      await expect(rows.nth(index).locator('span').first()).toHaveText(name)
      await expect(rows.nth(index).locator('span').last()).toHaveText(
        String(facts.monthToDate.portal_rating_count),
      )
    }
    await expect(rows.last()).toHaveText(`All portals${soFar}`)

    // The month on its strip, still running.
    await expect(
      page
        .getByRole('list', { name: 'Month by month' })
        .getByRole('button', { name: new RegExp(`^${monthName}: .+, running$`, 'u') }),
    ).toBeVisible()

    // The change log: the set, then each Portal going live, newest first.
    const changes = page.getByRole('region', { name: 'Changes' }).getByRole('listitem')
    await expect(changes.first()).toHaveText(
      new RegExp(
        `^${dayOf(0)} · .*[Ss]et ${target} a month from ${monthName}${recommended === undefined ? '' : ' \\(recommended\\)'}$`,
        'u',
      ),
    )
    await expect(changes.nth(1)).toHaveText(`${dayOf(8)} · Spa went live`)
    await expect(changes.nth(2)).toHaveText(
      `${dayOf(20)} · Reception and Restaurant went live`,
    )

    await dismissToasts(page)
    await assertNoAxeViolations(page, 'the monthly portal goal page (/goals/portals)')
    await page.evaluate(() => window.localStorage.setItem('theme', 'light'))
    await page.reload()
    await waitForHydration(page)
    await expect(page.locator('html')).toHaveClass(/\blight\b/u)
    await expect(rows).toHaveCount(PORTAL_NAMES.length + 1)
    await assertNoAxeViolations(page, 'the monthly portal goal page (light)')
  })

  test('J7 change from next month, then stop', async ({ page }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j7',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, restaurant, spa] = portals
    if (!reception || !restaurant || !spa) throw new Error('E2E Portals are not seeded')
    const days = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, index) => from - index)
    const input = await seedPortalHistory(propertyId, [
      {
        portal: reception,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 1),
        scansDaysAgo: [],
      },
      {
        portal: restaurant,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(10, 1),
        scansDaysAgo: [],
      },
      {
        portal: spa,
        liveDaysAgo: 8,
        codeDaysAgo: 17,
        ratingsDaysAgo: [],
        scansDaysAgo: [],
      },
    ])
    const recommendation = recommendPortalGoal(input)
    const month = recommendation.months.current.key
    const next = recommendation.months.next.key
    const soFar = recommendation.monthToDate.portal_rating_count ?? 0
    const target = soFar + 10
    // A number no recommendation can be: it is the manager's own.
    const changed = target + 7
    const monthName = formatMonthName(`${month}-15T12:00:00.000Z`)
    const nextName = formatMonthName(`${next}-15T12:00:00.000Z`)
    const nextFirst = formatLocalDate(`${next}-01`, { year: false })
    const lastDay = formatLocalDate(addLocalDays(`${next}-01`, -1), { year: false })
    const today = await localToday(propertyId)

    // This month's goal, set straight through the server function.
    await callServerFn(page, {
      file: MONTHLY_PORTAL_GOALS,
      exportName: 'setMonthlyPortalGoal',
      data: {
        propertyId,
        metric: 'portal_rating_count',
        targetValue: target,
        startMonth: month,
        targetSource: 'own',
      },
    })

    await page.goto(`/properties/${propertyId}/goals/portals`)
    await waitForHydration(page)
    await clickWhenReady(page.getByRole('button', { name: 'Change number' }))
    const sheet = page.getByRole('dialog', { name: 'Change your monthly portal goal' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('radio', { name: `From ${nextFirst}` }).click()
    await expect(sheet.getByText(`${monthName} stays at ${target}.`)).toBeVisible()
    await sheet.getByRole('spinbutton').fill(String(changed))
    await sheet.getByRole('button', { name: `Set ${changed} from ${nextName}` }).click()
    await expect(
      page.getByText(`From ${nextName}: ${changed} private ratings`),
    ).toBeVisible()
    await expect(sheet).toHaveCount(0)
    // This month is unchanged; the log has the change from next month.
    await expect(
      page.getByRole('region', { name: 'Changes' }).getByRole('listitem').first(),
    ).toHaveText(new RegExp(`[Ss]et ${changed} a month from ${nextName}$`, 'u'))

    await dismissToasts(page)
    await clickWhenReady(
      page.getByRole('button', { name: 'More actions for Monthly portal goal' }),
    )
    await page.getByRole('menuitem', { name: 'Stop this goal…' }).click()
    const dialog = page.getByRole('alertdialog', {
      name: 'Stop the monthly portal goal?',
    })
    await expect(
      dialog.getByText(
        `${monthName} keeps counting to ${lastDay} and keeps its result. You can set a new goal from ${nextName}.`,
      ),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop the goal' }).click()

    await expect(page).toHaveURL(new RegExp(`/properties/${propertyId}/goals$`, 'u'))
    await expect(page.getByText('Monthly portal goal stopped')).toBeVisible()
    await waitForHydration(page)
    const card = page.locator('#portal-goals [data-slot="portal-goal-card"]')
    await expect(
      card.getByText(
        `Stopped on ${formatLocalDate(today, { year: false })}. ${monthName} still counts to ${lastDay}.`,
      ),
    ).toBeVisible()
    await expect(
      card.getByRole('button', { name: `Set a goal from ${nextName}` }),
    ).toBeVisible()
  })
  test('J11 all monthly results: a closed month and an ended goal on their own page; both themes pass axe', async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j11',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, , spa] = portals
    if (!reception || !spa) throw new Error('E2E Portals are not seeded')
    const GOAL_PROGRAMS = 'src/contexts/reporting/server/goal-programs.ts'
    const startMonth = await nextMonthKey(propertyId)
    const create = (data: Readonly<Record<string, unknown>>) =>
      callServerFn<{ program: { id: string } }>(page, {
        file: GOAL_PROGRAMS,
        exportName: 'createGoalProgram',
        data: { propertyId, description: null, startMonth, ...data },
      })
    // Reception's goal, with a month that has closed: 12 of 20, not met.
    const counted = await create({
      name: 'Reception ratings',
      metric: 'portal_rating_count',
      targetValue: 20,
      subjects: [{ kind: 'portal', portalId: reception.id }],
    })
    const closed = await closePortalGoalMonth({
      propertyId,
      programId: counted.program.id,
      value: 12,
    })
    // Spa's goal, ended today.
    const stopped = await create({
      name: 'Spa scans',
      metric: 'qualified_scans',
      targetValue: 30,
      subjects: [{ kind: 'portal', portalId: spa.id }],
    })
    await callServerFn(page, {
      file: GOAL_PROGRAMS,
      exportName: 'changeGoalProgramStatus',
      data: {
        propertyId,
        programId: stopped.program.id,
        status: 'ended',
        reason: 'E2E an ended portal goal.',
      },
    })
    const endedOn = `Ended on ${formatLocalDate(await localToday(propertyId), { year: false })}`

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const section = page.locator('#portal-goals')
    await expect(
      section.getByRole('link', { name: 'Ended portal goals (1)' }),
    ).toHaveAttribute('href', `/properties/${propertyId}/goals/portal-results#ended`)
    await clickWhenReady(section.getByRole('link', { name: 'All monthly results' }))
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals/portal-results$`, 'u'),
    )
    await waitForHydration(page)

    await expect(
      page.getByRole('heading', { level: 1, name: 'Portal goal results' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: formatMonthYear(closed.periodStart, closed.timezone) ?? '',
      }),
    ).toBeVisible()
    // The month that has closed; a month the maintenance job opens since is
    // a row of its own.
    const row = page
      .getByRole('row')
      .filter({ hasText: 'Not met: 12 private ratings, the goal was 20.' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Reception ratings')

    // The ended goal, with the day it ended; the section's foot lands here.
    const ended = page
      .getByRole('list', { name: 'Ended portal goals' })
      .getByRole('listitem')
    await expect(ended).toHaveCount(1)
    await expect(ended.getByRole('link', { name: 'Spa scans' })).toBeVisible()
    await expect(ended).toContainText('Scans · target 30 · Spa')
    await expect(ended).toContainText(endedOn)

    await dismissToasts(page)
    await assertNoAxeViolations(page, 'the portal goal results page')
    await page.evaluate(() => window.localStorage.setItem('theme', 'light'))
    await page.reload()
    await waitForHydration(page)
    await expect(page.locator('html')).toHaveClass(/\blight\b/u)
    await expect(ended).toHaveCount(1)
    await assertNoAxeViolations(page, 'the portal goal results page (light)')

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    await clickWhenReady(section.getByRole('link', { name: 'Ended portal goals (1)' }))
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals/portal-results#ended$`, 'u'),
    )
    // The list's title takes the focus, so a keyboard arrives where the link said.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Ended portal goals' }),
    ).toBeFocused()
  })
  test('J12 History belongs to the Google section; the portal card stays on ?view=history', async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j12',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, , spa] = portals
    if (!reception || !spa) throw new Error('E2E Portals are not seeded')
    const GOAL_PROGRAMS = 'src/contexts/reporting/server/goal-programs.ts'
    const startMonth = await nextMonthKey(propertyId)
    const create = (data: Readonly<Record<string, unknown>>) =>
      callServerFn<{ program: { id: string } }>(page, {
        file: GOAL_PROGRAMS,
        exportName: 'createGoalProgram',
        data: { propertyId, description: null, startMonth, ...data },
      })
    // A Portal goal that has not ended, and one that has.
    await create({
      name: 'Reception ratings',
      metric: 'portal_rating_count',
      targetValue: 20,
      subjects: [{ kind: 'portal', portalId: reception.id }],
    })
    const stopped = await create({
      name: 'Spa scans',
      metric: 'qualified_scans',
      targetValue: 30,
      subjects: [{ kind: 'portal', portalId: spa.id }],
    })
    await callServerFn(page, {
      file: GOAL_PROGRAMS,
      exportName: 'changeGoalProgramStatus',
      data: {
        propertyId,
        programId: stopped.program.id,
        status: 'ended',
        reason: 'E2E an ended portal goal.',
      },
    })

    await page.goto(`/properties/${propertyId}/goals?view=history`)
    await waitForHydration(page)

    // The tabs are the Google section's: inside its one region, and the page's only ones.
    const google = page.getByRole('region', { name: 'Google rating goal', exact: true })
    await expect(google).toHaveCount(1)
    const tabs = google.getByRole('navigation', { name: 'Google rating goal views' })
    await expect(tabs.getByRole('link', { name: 'History' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page.getByRole('navigation', { name: 'Google rating goal views' }),
    ).toHaveCount(1)
    await expect(google.getByText('No Google rating goal history')).toBeVisible()

    // The Portal goals, outside the Google section, the same on both tabs: the
    // card, the goal not ended, and the way to the ended one, not listed here.
    const section = page.locator('#portal-goals')
    await expect(google.locator('#portal-goals')).toHaveCount(0)
    const expectPortalGoals = async () => {
      await expect(
        section
          .locator('[data-slot="portal-goal-card"]')
          .getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
      ).toBeVisible()
      await expect(section.getByRole('link', { name: 'Reception ratings' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Spa scans' })).toHaveCount(0)
      await expect(
        section.getByRole('link', { name: 'Ended portal goals (1)' }),
      ).toHaveAttribute('href', `/properties/${propertyId}/goals/portal-results#ended`)
    }
    await expectPortalGoals()

    await dismissToasts(page)
    await assertNoAxeViolations(page, 'the Goals page, History tab')
    // The landmarks changed (one region named "Google rating goal"): both themes pass axe.
    await page.evaluate(() => window.localStorage.setItem('theme', 'light'))
    await page.reload()
    await waitForHydration(page)
    await expect(page.locator('html')).toHaveClass(/\blight\b/u)
    await expectPortalGoals()
    await assertNoAxeViolations(page, 'the Goals page, History tab (light)')

    // Active: the Google section's own view changes; the Portal goals do not.
    await clickWhenReady(tabs.getByRole('link', { name: 'Active' }))
    await expect(page).toHaveURL(
      new RegExp(`/properties/${propertyId}/goals\\?view=active$`, 'u'),
    )
    await expect(tabs.getByRole('link', { name: 'Active' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(google.getByText('No Google rating goal history')).toHaveCount(0)
    await expectPortalGoals()
  })

  test('J13 a goal for one portal, one click deeper; /goals/new redirects', async ({
    page,
  }, testInfo) => {
    await signIn(page, seed.email, seed.password, BASE_ORIGIN)
    const { propertyId, portals } = await seedPortalGoalProperty(
      page,
      'j13',
      testInfo.retry,
    )
    seeded.push(propertyId)
    const [reception, restaurant, spa] = portals
    if (!reception || !restaurant || !spa) throw new Error('E2E Portals are not seeded')
    const days = (from: number, to: number) =>
      Array.from({ length: from - to + 1 }, (_, index) => from - index)
    const input = await seedPortalHistory(propertyId, [
      {
        portal: reception,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(19, 1),
        scansDaysAgo: [],
      },
      {
        portal: restaurant,
        liveDaysAgo: 20,
        codeDaysAgo: 21,
        ratingsDaysAgo: days(10, 1),
        scansDaysAgo: [],
      },
      {
        portal: spa,
        liveDaysAgo: 8,
        codeDaysAgo: 17,
        ratingsDaysAgo: [],
        scansDaysAgo: [],
      },
    ])
    // Reception's own number: the rule on its own rate, in the month offered.
    const recommendation = recommendPortalGoal(input)
    const facts = recommendation.portals.find(({ name }) => name === 'Reception')
    if (!facts) throw new Error('The rule lists no Reception')
    const own = subjectRecommendation({
      members: [facts],
      monthToDate: facts.monthToDate,
      unreadable: new Set(),
      months: recommendation.months,
    }).portal_rating_count
    const month = recommendation.defaultMonthKey
    const offered =
      month === recommendation.months.current.key ? own.fromToday : own.fullMonth.next
    if (!offered) throw new Error('Reception has no number of its own')
    const number = offered.aBitMore
    const monthName = formatMonthName(`${month}-15T12:00:00.000Z`)

    await page.goto(`/properties/${propertyId}/goals`)
    await waitForHydration(page)
    const section = page.locator('#portal-goals')
    await clickWhenReady(section.getByRole('button', { name: 'Add a portal goal' }))
    const sheet = page.getByRole('dialog', { name: 'Add a portal goal' })
    await expect(sheet.getByText('What do you want to add?')).toBeVisible()
    await expect(
      sheet.getByText('Portal goals are about the spot, not the person who works there.'),
    ).toBeVisible()
    await clickWhenReady(sheet.getByRole('radio', { name: /^A goal for one portal/u }))
    await clickWhenReady(sheet.getByRole('button', { name: 'Next' }))
    await clickWhenReady(sheet.getByRole('radio', { name: /^Reception/u }))
    await clickWhenReady(sheet.getByRole('button', { name: 'Next' }))
    await expect(sheet.getByText(`Reception · ${monthName}`)).toBeVisible()
    await expect(sheet.getByRole('spinbutton')).toHaveValue(String(number))
    await dismissToasts(page)
    await assertNoAxeViolations(page, 'Add a portal goal, the number step')

    await clickWhenReady(
      sheet.getByRole('button', { name: `Set ${number} for ${monthName}` }),
    )
    await expect(
      page.getByText(`Reception goal set: ${number} private ratings for ${monthName}`),
    ).toBeVisible()
    await expect(sheet).toHaveCount(0)
    // Next to the Monthly portal goal's card, under "More portal goals".
    await expect(
      section.getByRole('link', { name: 'Reception · Private ratings', exact: true }),
    ).toBeVisible()

    // The old address opens the same sheet on the goal page, on its first step.
    await page.goto(`/properties/${propertyId}/goals/new`)
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/properties/${propertyId}/goals/portals` &&
        url.searchParams.get('add') === 'choose',
    )
    await waitForHydration(page)
    await expect(sheet.getByText('What do you want to add?')).toBeVisible()
    await clickWhenReady(sheet.getByRole('button', { name: 'Cancel' }))
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL((url) => !url.searchParams.has('add'))
  })
})
