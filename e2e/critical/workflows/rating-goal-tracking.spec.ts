// Round 5 of the Google rating goal (PLAN-D D-1, D-2, D-2b, D-3), as the check-in
// of 2026-11-01 draws its tracking (ADR 0067): the card that counts the new
// reviews to the next number Google can show and puts the goal on a ruler, on the
// Goals page and on the Property Overview, the detail page one click from it (where
// the goal stands, then three questions in the bands Guest voice and Portal Results
// use), and the Monday check-in above the card (mock D4), for the people who may
// see them and for no one else.
//
// Journeys:
//   1. the owner sets a goal (the setup's own command) and sees the card on the
//      Property's Goals page and on its Overview: "2 new reviews to 4.0", the ruler
//      from 3.9 to the goal and when it arrives;
//   2. manager-one (granted the Property) sees the same card; manager-zero (no
//      grant: `scope_denied`) and the staff Member (`beta_role_inactive`) are
//      refused the card read;
//   3. the owner opens the detail: the headline and the ruler, "Is your rating going
//      up?" with its line to the goal, "Are enough good reviews coming in?" with its
//      weekly bars, "What can you do this week?", and "What happened", closed until
//      asked, ending in the set's row; "Owners and managers only" is the page's foot,
//      outside that card; both goals pages pass the axe scan;
//   4. a 2★ review after the set is named in "What happened" with what it set the
//      goal back, and its link opens its Inbox item; an expired 1★ review since the
//      set is not named (D-2b, the owner’s exception);
//   5. a goal set 15 days ago gets the Monday check-in, on manager-one's
//      Overview too: the owner keeps the pace, and it is gone after a reload
//      and, reloaded, from manager-one's Overview; asked again,
//      the owner raises the pace: a pace row in the change log, and the goal
//      is getting started again (Q3).
//
// The seed's Properties have no Google binding, so a goal on them only ever
// waits for Google. This spec seeds its own bound Property (prefix `e2e-rg-`)
// with twelve Google reviews (47 stars: exact 3.917, Google shows 3.9) and
// Google's numbers for them, verified now. Traps it handles (PLAN-D §3.4):
//   - Google's numbers older than 24 hours make a goal wait, so they are
//     written at the start of the run;
//   - the cache holds exactly Google's count, so the exact average is the
//     cache's (every count reads exact, with no "About");
//   - the goal tables hold RESTRICT foreign keys onto the Property, so its
//     rating goal rows go before the prefix cleanup removes the Property.
import type { Page } from '@playwright/test'
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import {
  callServerFn,
  callServerFnGetExpectError,
  cleanupE2eData,
  dbQuery,
  e2eRunId,
  getUserByEmail,
  seedGoogleConnection,
  seedProperty,
  seedReview,
  seedReviewInboxItemWithCycle,
} from '../../helpers/fixtures'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { assertNoAxeViolations } from '../../helpers/a11y'
import { clickWhenReady, waitForHydration } from '../../helpers/interaction'

const PREFIX = 'e2e-rg-'
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const RATING_GOALS = 'src/contexts/reporting/server/rating-goals.ts'
const seed = requireE2eSeedState()

/** Twelve reviews, 47 stars: 3.917 exactly, which Google shows as 3.9. */
const STARS = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3] as const
const DAY_MS = 24 * 60 * 60 * 1000

async function removeRatingGoals(): Promise<void> {
  const scope = `property_id IN (SELECT id FROM properties WHERE organization_id = $1 AND slug LIKE $2)`
  const args = [seed.organizationId, `${PREFIX}%`]
  await dbQuery(`DELETE FROM property_rating_goal_changes WHERE ${scope}`, args)
  await dbQuery(`DELETE FROM property_rating_goals WHERE ${scope}`, args)
}

async function cleanUp(): Promise<void> {
  await removeRatingGoals()
  await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
}

/** A bound Property with twelve Google reviews and Google's numbers for them. */
async function seedRatedProperty(): Promise<string> {
  const owner = await getUserByEmail(seed.email)
  const managerOne = await getUserByEmail(seed.onePropertyManagerEmail)
  expect(owner && managerOne).toBeTruthy()
  const { connectionId } = await seedGoogleConnection({
    organizationId: seed.organizationId,
    connectedBy: owner!.id,
    googleSubject: `${PREFIX}subject-${e2eRunId}`,
  })
  const { propertyId } = await seedProperty({
    organizationId: seed.organizationId,
    name: `E2E Rating Goal Hotel ${e2eRunId}`,
    slug: `${PREFIX}${e2eRunId}`,
    grantAccessToUserId: managerOne!.id,
    googleBinding: {
      connectionId,
      accountId: `${PREFIX}account-${e2eRunId}`,
      locationId: `${PREFIX}location-${e2eRunId}`,
    },
  })
  for (const [index, rating] of STARS.entries()) {
    await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${PREFIX}review-${index}-${e2eRunId}`,
      rating,
      googleConnectionId: connectionId,
      reviewedAt: new Date(Date.now() - (20 - index) * DAY_MS),
    })
  }
  await dbQuery(
    `INSERT INTO metric_current_google_reputation_snapshots
       (property_id, organization_id, source_epoch, source_run_id, source_event_id,
        review_count, average_rating, evaluated_at, updated_at)
     SELECT id, organization_id, source_epoch, gen_random_uuid(), gen_random_uuid(),
            $3, 3.9, now(), now()
       FROM properties WHERE organization_id = $1 AND id = $2`,
    [seed.organizationId, propertyId, STARS.length],
  )
  return propertyId
}

async function setGoalAsOwner(page: Page, propertyId: string): Promise<void> {
  await callServerFn(page, {
    file: RATING_GOALS,
    exportName: 'setRatingGoal',
    data: {
      propertyId,
      mode: 'climb',
      targetTenths: 40,
      qualityTenths: 42,
      paceTenthsPerWeek: 70,
    },
  })
}

/**
 * The ruler's one sentence for this Property: Google showed 3.9 when the goal was set
 * and shows it still, so there is no "Started at", and 3.9 to 4.0 has no stop between.
 */
const RULER_NAME = 'Google shows 3.9 now. Your goal is 4.0.'

/** 12 × (3.95 − 3.917) / (4.2 − 3.95) = 1.6: two new reviews to 4.0. */
async function expectClimbCard(page: Page, propertyId: string): Promise<void> {
  const card = page.locator('[data-slot="rating-goal-card"]')
  await expect(
    card.getByRole('heading', { level: 2, name: 'Google rating goal' }),
  ).toBeVisible()
  await expect(card.getByText('2 new reviews to 4.0', { exact: true })).toBeVisible()
  // The ruler is a picture named by one sentence; Google's number leads, never the exact average.
  await expect(card.getByRole('img', { name: RULER_NAME, exact: true })).toBeVisible()
  // When it arrives: the one sentence, at every width.
  await expect(card.getByText(/4\.0 in about 2 days/u)).toBeVisible()
  await expect(card.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    `/properties/${propertyId}/goals/google-rating`,
  )
}

test.describe('Critical workflow: the Google rating goal card (round 5)', () => {
  test.describe.configure({ mode: 'serial' })

  let propertyId = ''

  test.beforeAll(async () => {
    await cleanUp()
    propertyId = await seedRatedProperty()
  })

  test.afterAll(async () => {
    await cleanUp()
  })

  test('the owner sets a goal and sees the card on Goals and on the Overview', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`/properties/${propertyId}/goals`)
    await setGoalAsOwner(page, propertyId)

    await page.goto(`/properties/${propertyId}/goals`)
    await expectClimbCard(page, propertyId)

    await page.goto(`/properties/${propertyId}`)
    await expectClimbCard(page, propertyId)
  })

  test('manager-one sees the card; manager-zero and the staff Member are refused it', async ({
    browser,
  }) => {
    const oneContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const onePage = await oneContext.newPage()
    await signIn(
      onePage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await onePage.goto(`/properties/${propertyId}/goals`)
    await expectClimbCard(onePage, propertyId)
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
        file: RATING_GOALS,
        exportName: 'getRatingGoalCard',
        data: { propertyId },
      })
      expect(error.code).toBe(refusal)
      await context.close()
    }
  })

  test('the owner opens the detail: where the goal stands, its three questions and what happened', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`/properties/${propertyId}/goals`)
    await expectClimbCard(page, propertyId)
    await assertNoAxeViolations(page, 'Goals page with the rating goal card')

    await page.goto(`/properties/${propertyId}/goals/google-rating`)
    // "What happened" opens on a press, which sends nothing before React hydrates.
    await waitForHydration(page)
    const detail = page.locator('[data-slot="rating-goal-detail"]')
    // Where the goal stands comes first: the card's headline and its ruler.
    await expect(detail.getByText('2 new reviews to 4.0', { exact: true })).toBeVisible()
    await expect(detail.getByRole('img', { name: RULER_NAME, exact: true })).toBeVisible()
    // Then three questions, each in a band of its own.
    for (const question of [
      'Is your rating going up?',
      'Are enough good reviews coming in?',
      'What can you do this week?',
    ]) {
      await expect(
        detail.getByRole('heading', { level: 2, name: question }),
      ).toBeVisible()
    }
    // The line up to the goal and the weeks against the plan: each a figure named by its caption.
    await expect(
      detail.getByRole('figure', { name: 'Your rating on Google' }),
    ).toBeVisible()
    await expect(
      detail.getByRole('figure', { name: 'New reviews each week' }),
    ).toBeVisible()
    // "What happened" is closed until asked: its rows show after a press.
    const moved = detail
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: 'What happened' }) })
    const setRow = moved.getByText(/set the goal: 4\.0 at 1 a day$/u)
    await expect(setRow).toHaveCount(0)
    await clickWhenReady(moved.getByRole('button', { name: 'What happened' }))
    await expect(setRow).toBeVisible()
    // How fresh Google's numbers are, and who sees the page, are the page's foot, not that card's.
    await expect(detail.getByText('Owners and managers only')).toBeVisible()
    await expect(moved.getByText('Owners and managers only')).toHaveCount(0)
    await assertNoAxeViolations(page, 'the rating goal detail (/goals/google-rating)')
  })

  test('a low review since the set opens in the Inbox; an expired one is not named', async ({
    page,
  }) => {
    // Now: after the goal the first journey set.
    const now = new Date()
    const { reviewId } = await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${PREFIX}low-${e2eRunId}`,
      rating: 2,
      text: 'The room was cold all night.',
      reviewerName: 'Low Review Guest',
      reviewedAt: now,
    })
    const { inboxItemId } = await seedReviewInboxItemWithCycle({
      organizationId: seed.organizationId,
      propertyId,
      reviewId,
    })
    // Its content has expired: it is no longer a review any goal read counts.
    await seedReview({
      organizationId: seed.organizationId,
      propertyId,
      externalId: `${PREFIX}expired-${e2eRunId}`,
      rating: 1,
      reviewedAt: now,
      contentExpiresAt: new Date(Date.now() - DAY_MS),
    })
    // Google counts the new one too: 13 reviews, 49 stars (3.769), shown 3.8.
    await dbQuery(
      `UPDATE metric_current_google_reputation_snapshots
          SET review_count = $3, average_rating = 3.8, evaluated_at = now(), updated_at = now()
        WHERE organization_id = $1 AND property_id = $2`,
      [seed.organizationId, propertyId, STARS.length + 1],
    )

    await signIn(page)
    await page.goto(`/properties/${propertyId}/goals/google-rating`)
    await waitForHydration(page)
    const moved = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: 'What happened' }) })
    // "What happened" is closed until asked, on every load of the page.
    const openMoved = () =>
      clickWhenReady(moved.getByRole('button', { name: 'What happened' }))
    await openMoved()
    // 13 × (3.95 − 3.769) / (4.1 − 3.95) = 15.7 with it (the blend held at
    // 4.1 before the tenth review); 1.6 at the plan's 4.2 without it.
    await expect(moved.getByText('2★ review', { exact: true })).toBeVisible()
    await expect(moved.getByText('set you back about 14 new reviews')).toBeVisible()
    await expect(moved.getByText('1★ review', { exact: true })).toHaveCount(0)
    const open = moved.getByRole('link', {
      name: /^Open in the inbox: the 2★ review of .+$/u,
    })
    await expect(open).toHaveAttribute(
      'href',
      `/properties/${propertyId}/reviews?itemId=${inboxItemId}`,
    )
    await expect(moved.locator('a[href*="reviewId="]')).toHaveCount(0)
    // The low review's warning ink and its link, with the real CSS, both themes.
    await assertNoAxeViolations(page, 'the rating goal detail with a low review')
    await page.evaluate(() => window.localStorage.setItem('theme', 'light'))
    await page.reload()
    // The reload closed the card again: ask for it before reading a row or following its link.
    await waitForHydration(page)
    await openMoved()
    await expect(moved.getByText('set you back about 14 new reviews')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/\blight\b/u)
    await assertNoAxeViolations(page, 'the rating goal detail with a low review (light)')

    await open.click()
    await expect(page).toHaveURL(new RegExp(`itemId=${inboxItemId}`, 'u'))
    await expect(page.getByText('Low Review Guest').first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('the Monday check-in: Keep answers it for everyone, Raise starts the pace afresh', async ({
    page,
    browser,
  }) => {
    // Set 15 days ago: last week began after the set, so this week asks.
    await dbQuery(
      `UPDATE property_rating_goals
          SET created_at = now() - interval '15 days', pace_since = now() - interval '15 days'
        WHERE organization_id = $1 AND property_id = $2 AND status = 'active'`,
      [seed.organizationId, propertyId],
    )
    // manager-one sees the same check-in on the Overview before anyone answers it.
    const oneContext = await browser.newContext({ baseURL: BASE_ORIGIN })
    const onePage = await oneContext.newPage()
    await signIn(
      onePage,
      seed.onePropertyManagerEmail,
      seed.boundedManagerPassword,
      BASE_ORIGIN,
    )
    await onePage.goto(`/properties/${propertyId}`)
    await expect(
      onePage
        .getByRole('region', { name: 'Last week' })
        .getByRole('button', { name: 'Keep 1 a day' }),
    ).toBeVisible()

    await signIn(page)
    await page.goto(`/properties/${propertyId}/goals`)
    // The server-rendered buttons are clickable before React hydrates, and a
    // press in that window sends nothing: wait it out after every load.
    await waitForHydration(page)
    const recap = page.getByRole('region', { name: 'Last week' })
    await expect(recap.getByText('Nothing changes unless you choose.')).toBeVisible()
    await assertNoAxeViolations(page, 'Goals page with the Monday check-in')

    await clickWhenReady(recap.getByRole('button', { name: 'Keep 1 a day' }))
    await expect(recap).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Google rating goal' }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Last week' })).toHaveCount(0)

    // The owner's Keep answered it for manager-one too.
    await onePage.reload()
    await expect(
      onePage.getByRole('heading', { level: 2, name: 'Google rating goal' }),
    ).toBeVisible()
    await expect(onePage.getByRole('region', { name: 'Last week' })).toHaveCount(0)
    await oneContext.close()

    // Asked again (the kept week forgotten): Raise is a change of pace.
    await dbQuery(
      `UPDATE property_rating_goals SET recap_answered_week = NULL
        WHERE organization_id = $1 AND property_id = $2 AND status = 'active'`,
      [seed.organizationId, propertyId],
    )
    await page.reload()
    await waitForHydration(page)
    await clickWhenReady(
      page
        .getByRole('region', { name: 'Last week' })
        .getByRole('button', { name: 'Raise to 2 a day' }),
    )
    await expect(page.getByRole('region', { name: 'Last week' })).toHaveCount(0)
    await expect(
      page.locator('[data-slot="rating-goal-card"]').getByText('Getting started'),
    ).toBeVisible()
    const log = await dbQuery<{ field: string; old_value: string; new_value: string }>(
      `SELECT field, old_value, new_value FROM property_rating_goal_changes
        WHERE organization_id = $1 AND property_id = $2`,
      [seed.organizationId, propertyId],
    )
    expect(log).toEqual([{ field: 'pace', old_value: '70', new_value: '140' }])
  })
})
