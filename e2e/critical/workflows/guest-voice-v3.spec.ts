// Guest voice 2.0 and the Inbox's reading of a review, for a Property whose reviews carry a
// v3 analysis (v3 contract; ADR 0046 and 0071 as amended 2026-10-30).
//
// The analysis rows are written through the product's own stores by the seed the
// integration suites use (`ai-v3-fixtures.ts`): twelve invented reviews, four of which say
// the air conditioning is not working. No provider is called and no guest's words exist.
//
// Journeys (one fixture, serial, because the seed moves the shared AI execution controls):
//   1. a PropertyManager reads Guest voice 2.0 at desktop size: "In short", "Fix first"
//      with the air conditioning on top, no line about a Google rating goal for a Property
//      with none, the page axe-clean; "See all 4 reviews" opens the Inbox on those reviews
//      with the issue and the window in the address;
//   2. the same page at 390 px: nothing scrolls sideways, and it is axe-clean;
//   3. a review found Urgent after it was seen raises exactly one alert for the Property's
//      responsible manager, "An urgent review needs you", which names no reason and no
//      word of the review (ADR 0046 r.8); a second Urgent analysis of the same revision
//      raises no second one; and the Inbox item says why, in the app, beside the review's
//      topics and "Not right?".
//
// Not covered here, and why: the Google rating goal line beside the top problem needs a
// Property with a Google binding and Google's numbers (see rating-goal-tracking.spec.ts),
// so it is held by the page's unit tests and its stories; here only its absence is checked.
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { assertNoAxeViolations } from '../../helpers/a11y'
import { clickWhenReady } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import type { ReviewAnalysisMentionV3 } from '../../../src/contexts/ai/domain/types'
import { daysAgo, setUpV3Fixture, type V3Fixture } from '../../helpers/ai-v3-fixtures'
import {
  cleanupE2eData,
  findOutboxEvents,
  getNotificationsForUser,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-gv3-'
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seedState = requireE2eSeedState()

/** A mention, filled in with the usual defaults. */
function mentionOf(
  fields: Pick<ReviewAnalysisMentionV3, 'topic' | 'polarity'> &
    Partial<ReviewAnalysisMentionV3>,
): ReviewAnalysisMentionV3 {
  return {
    strength: 'clear',
    thing: null,
    issue: null,
    sentences: [1],
    namesPerson: null,
    ...fields,
  }
}

const AIR_CONDITIONING = mentionOf({
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [1],
})
const BREAKFAST = mentionOf({
  topic: 'food_drink',
  polarity: 'positive',
  thing: 'breakfast',
  issue: 'fresh',
  sentences: [1],
})
const STAFF_PRAISE = mentionOf({
  topic: 'staff_service',
  polarity: 'positive',
  strength: 'strong',
  namesPerson: 'team_member',
  sentences: [1],
})
const RAILING = mentionOf({
  topic: 'safety',
  polarity: 'negative',
  strength: 'strong',
  thing: 'balcony railing',
  issue: 'loose',
  sentences: [1],
})

/** The review that is found Urgent later in the spec, and the Inbox item made for it. */
const LATE_URGENT_REVIEW = 12

async function seedReviews(fixture: V3Fixture): Promise<void> {
  const { seed } = fixture
  for (const index of [1, 2, 3, 4]) {
    await seed.addReview({
      index,
      rating: 2,
      reviewedAt: daysAgo(index),
      sentiment: 'negative',
      attention: 'high',
      mentions: [AIR_CONDITIONING],
    })
  }
  for (const index of [5, 6, 7]) {
    await seed.addReview({
      index,
      rating: 5,
      reviewedAt: daysAgo(index),
      sentiment: 'positive',
      mentions: [BREAKFAST],
    })
  }
  await seed.addReview({
    index: 8,
    rating: 5,
    reviewedAt: daysAgo(8),
    sentiment: 'positive',
    mentions: [STAFF_PRAISE],
  })
  for (const index of [9, 10, 11]) {
    await seed.addReview({
      index,
      rating: 4,
      reviewedAt: daysAgo(index),
      sentiment: 'neutral',
      mentions: [],
    })
  }
  // Seen first as a serious complaint; it is found Urgent in the third journey.
  await seed.addReview({
    index: LATE_URGENT_REVIEW,
    rating: 1,
    reviewedAt: daysAgo(0),
    sentiment: 'negative',
    attention: 'high',
    mentions: [RAILING],
  })
  await seed.seal()
}

test.describe('Critical workflow: Guest voice 2.0 and the Inbox reading, v3 analyses', () => {
  test.describe.configure({ mode: 'serial' })

  let fixture: V3Fixture
  /** The Inbox item of each review that has one, by the review's index. */
  const inboxItems = new Map<number, string>()

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    await cleanupE2eData({ organizationId: seedState.organizationId, prefix: PREFIX })
    fixture = await setUpV3Fixture({
      organizationId: seedState.organizationId,
      prefix: PREFIX,
      label: 'guest-voice',
    })
    await seedReviews(fixture)
    // The four air conditioning reviews and the one found Urgent later are in the Inbox.
    for (const index of [1, 2, 3, 4, LATE_URGENT_REVIEW]) {
      inboxItems.set(index, await fixture.openInboxItem(index))
    }
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await fixture?.tearDown()
  })

  test('a manager reads what to fix first and follows it into the Inbox', async ({
    page,
  }) => {
    await signIn(page, fixture.manager.email, fixture.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${fixture.propertyId}/guests`)

    await expect(page.getByRole('heading', { name: 'In short' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('heading', { name: 'Fix first' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Air conditioning', level: 3 }).first(),
    ).toBeVisible()
    // A Property with no Google rating goal draws no line about one.
    await expect(
      page.getByRole('region', { name: 'Your Google rating goal' }),
    ).toHaveCount(0)
    await assertNoAxeViolations(page, 'Guest voice 2.0 (desktop)')

    // "See all 4 reviews" is the four reviews the figure counted, in the window it counted.
    await clickWhenReady(page.getByRole('link', { name: 'See all 4 reviews' }).first())
    await page.waitForURL(/\/inbox\?/, { timeout: 20_000 })
    await expect(page).toHaveURL(/issue=[0-9a-f-]{36}/)
    await expect(page).toHaveURL(/since=\d{4}-\d{2}-\d{2}/)
    await expect(page).toHaveURL(/until=\d{4}-\d{2}-\d{2}/)
    await expect(page.getByText('Synthetic reviewer').first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('the page holds together on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, fixture.manager.email, fixture.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${fixture.propertyId}/guests`)

    await expect(page.getByRole('heading', { name: 'Fix first' })).toBeVisible({
      timeout: 20_000,
    })
    const reflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      reflow.scrollWidth,
      `Guest voice scrolls sideways at 390px: scrollWidth ${reflow.scrollWidth} > clientWidth ${reflow.clientWidth}`,
    ).toBeLessThanOrEqual(reflow.clientWidth + 8)
    await assertNoAxeViolations(page, 'Guest voice 2.0 (phone)')
  })

  test('an Urgent finding raises one content-free alert and the Inbox says why', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const { manager, organizationId, seed } = fixture
    const reviewId = fixture.reviewIdOf(LATE_URGENT_REVIEW)
    const itemId = inboxItems.get(LATE_URGENT_REVIEW)
    if (itemId === undefined)
      throw new Error('The Inbox item of the late Urgent review is missing')

    const urgent = {
      index: LATE_URGENT_REVIEW,
      rating: 1,
      reviewedAt: daysAgo(0),
      sentiment: 'negative',
      attention: 'urgent',
      urgentReason: 'safety',
      mentions: [RAILING],
    } as const
    await seed.reanalyze({ ...urgent, sequence: 13 })

    const alert = await waitFor(
      async () =>
        (await getNotificationsForUser(manager.userId)).find(
          (row) => row.type === 'review.ai_urgent_detected' && row.resource_id === itemId,
        ) ?? null,
      {
        timeoutMs: 90_000,
        description: 'the Urgent alert for the Property’s responsible manager',
      },
    )
    expect(String(alert.title)).toMatch(/^An urgent review needs you/)
    // ADR 0046 r.8: the alert says that an urgent review needs the manager and nothing of
    // why. The reason is read in the app.
    expect(
      JSON.stringify([alert.title, alert.body, alert.payload]),
      'the alert must carry no reason, topic or word of the review',
    ).not.toMatch(/safety|health|discriminat|legal|railing|balcony|loose/i)

    // The same revision found Urgent again is the same alert: one fact, however often it is found.
    await seed.reanalyze({ ...urgent, sequence: 14 })
    const facts = await findOutboxEvents({
      eventType: 'ai.review_analysis.urgent_detected',
      organizationId,
      payloadFragment: reviewId,
    })
    expect(facts).toHaveLength(1)

    await signIn(page, manager.email, manager.password, BASE_ORIGIN)
    await page.goto(`/inbox?itemId=${itemId}`)
    await expect(page.getByText(/The guest reports a risk to safety/)).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('list', { name: 'Review topics' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Not right?' })).toBeVisible()
    await assertNoAxeViolations(page, 'Inbox item with a v3 reading')
  })
})
