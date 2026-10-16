// Round 5 of the Google rating goal (PLAN-D D-1): the card that counts the new
// reviews to the next number Google can show, on the Goals page and on the
// Property Overview, for the people who may see it and for no one else.
//
// Journeys:
//   1. the owner sets a goal (the setup's own command) and sees the card on
//      /properties/<p1>/goals and on the Property Overview;
//   2. manager-one (a grant on P1) sees the same card; manager-zero (no grant)
//      and the staff Member are refused the card read.
//
// Traps this spec handles (PLAN-D §3.4):
//   - Google's numbers older than 24 hours make a goal "Waiting for Google", so
//     the seeded snapshot is re-verified (its evaluated_at moved to now) first;
//   - no review is added here: a cache that disagrees with Google's count turns
//     the card to Google's own rounded figure (no squares);
//   - P1 is shared and holds one active goal at most, and the goal tables hold
//     RESTRICT foreign keys, so P1's rating goal rows are removed before and
//     after (no other spec sets one).
import type { Page } from '@playwright/test'
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { callServerFn, callServerFnGetExpectError, dbQuery } from '../../helpers/fixtures'
import { requireE2eSeedState } from '../../helpers/seed-state'

const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const RATING_GOALS = 'src/contexts/reporting/server/rating-goals.ts'
const seed = requireE2eSeedState()
const P1 = seed.p1PropertyId

/** "18 new reviews to 4.1", or "Google should show 4.1 soon" once it is earned. */
const HEADLINE =
  /^(about )?\d[\d,]* new reviews? to \d\.\d$|^Google should show \d\.\d soon$/u

async function removeP1RatingGoals(): Promise<void> {
  await dbQuery(
    `DELETE FROM property_rating_goal_changes WHERE organization_id = $1 AND property_id = $2`,
    [seed.organizationId, P1],
  )
  await dbQuery(
    `DELETE FROM property_rating_goals WHERE organization_id = $1 AND property_id = $2`,
    [seed.organizationId, P1],
  )
}

/** Google's numbers for P1 as verified now: a goal reads them as current. */
async function refreshGoogleNumbers(): Promise<number> {
  const rows = await dbQuery<{ average_rating: number | null }>(
    `UPDATE metric_current_google_reputation_snapshots
        SET evaluated_at = now(), updated_at = now()
      WHERE organization_id = $1 AND property_id = $2
      RETURNING average_rating`,
    [seed.organizationId, P1],
  )
  const average = rows[0]?.average_rating
  if (average === null || average === undefined) {
    throw new Error(
      'P1 has no Google numbers: the e2e seed (ensureGoogleNumbers) did not run',
    )
  }
  return average
}

/** The tenth Google shows, half up from its float32 figure. */
const shownTenths = (average: number): number =>
  Math.floor((Math.round(average * 1_000_000) + 50_000) / 100_000)

async function setGoalAsOwner(page: Page, googleAverage: number): Promise<number> {
  const target = shownTenths(googleAverage) + 1
  await callServerFn(page, {
    file: RATING_GOALS,
    exportName: 'setRatingGoal',
    data: {
      propertyId: P1,
      mode: 'climb',
      targetTenths: target,
      // The least a plan for the target may assume is the target plus a tenth.
      qualityTenths: Math.min(50, target + 2),
      paceTenthsPerWeek: 70,
    },
  })
  return target
}

async function expectClimbCard(page: Page, targetTenths: number): Promise<void> {
  const card = page.locator('[data-slot="rating-goal-card"]')
  await expect(
    card.getByRole('heading', { level: 2, name: 'Google rating goal' }),
  ).toBeVisible()
  await expect(card.locator('p').filter({ hasText: HEADLINE }).first()).toBeVisible()
  // The ladder names the goal, upright or across, whichever this width draws.
  await expect(
    card.getByRole('img', {
      name: new RegExp(`Your goal is ${(targetTenths / 10).toFixed(1)}\\.`, 'u'),
    }),
  ).toBeVisible()
  await expect(card.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    `/properties/${P1}/goals/google-rating`,
  )
}

test.describe('Critical workflow: the Google rating goal card (round 5)', () => {
  test.describe.configure({ mode: 'serial' })

  let googleAverage = 0

  test.beforeAll(async () => {
    await removeP1RatingGoals()
    googleAverage = await refreshGoogleNumbers()
  })

  test.afterAll(async () => {
    await removeP1RatingGoals()
  })

  test('the owner sets a goal and sees the card on Goals and on the Overview', async ({
    page,
  }) => {
    test.skip(shownTenths(googleAverage) >= 49, 'P1 shows 4.9: there is nothing to climb')
    await signIn(page)
    await page.goto(`/properties/${P1}/goals`)
    const target = await setGoalAsOwner(page, googleAverage)

    await page.goto(`/properties/${P1}/goals`)
    await expectClimbCard(page, target)

    await page.goto(`/properties/${P1}`)
    await expectClimbCard(page, target)
  })

  test('manager-one sees the card; manager-zero and the staff Member are refused it', async ({
    browser,
  }) => {
    test.skip(shownTenths(googleAverage) >= 49, 'P1 shows 4.9: there is nothing to climb')
    const target = shownTenths(googleAverage) + 1

    const oneContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const onePage = await oneContext.newPage()
    await signIn(
      onePage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await onePage.goto(`/properties/${P1}/goals`)
    await expectClimbCard(onePage, target)
    await oneContext.close()

    for (const [email, password] of [
      [seed.zeroPropertyManagerEmail, seed.boundedManagerPassword],
      [seed.staffEmail, seed.staffPassword],
    ] as const) {
      const context = await browser.newContext({ baseURL: BASE_ORIGIN })
      const refused = await context.newPage()
      await signIn(refused, email, password, BASE_ORIGIN)
      const error = await callServerFnGetExpectError(refused, {
        file: RATING_GOALS,
        exportName: 'getRatingGoalCard',
        data: { propertyId: P1 },
      })
      expect(error.code).toMatch(/^(forbidden|not_found)$/u)
      await context.close()
    }
  })
})
