// H check-in and live detail journeys over synthetic dated v3 facts.
// No integration/browser run is claimed locally; CI supplies the disposable stack.
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { assertNoAxeViolations } from '../../helpers/a11y'
import { clickWhenReady } from '../../helpers/interaction'
import { requireE2eSeedState } from '../../helpers/seed-state'
import type { ReviewAnalysisMentionV3 } from '../../../src/contexts/ai/domain/types'
import {
  daysAgo,
  setUpV3Fixture,
  seedSmallCheckIn,
  type V3Fixture,
} from '../../helpers/ai-v3-fixtures'
import {
  cleanupE2eData,
  closeInboxItemBySourceAuthority,
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
      attention: index === 1 ? 'urgent' : 'high',
      urgentReason: index === 1 ? 'health' : undefined,
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
      reviewedAt: daysAgo(index * 10),
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
  let small: V3Fixture
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
    small = await setUpV3Fixture({
      organizationId: seedState.organizationId,
      prefix: PREFIX,
      label: 'small-check-in',
    })
    await seedSmallCheckIn(small)
    for (const index of [101, 102, 103]) await small.openInboxItem(index)
    // The four air conditioning reviews and the one found Urgent later are in the Inbox.
    for (const index of [1, 2, 3, 4, LATE_URGENT_REVIEW]) {
      inboxItems.set(index, await fixture.openInboxItem(index))
    }
    const handled = inboxItems.get(4)
    if (!handled) throw new Error('Missing handled fixture item')
    await closeInboxItemBySourceAuthority({
      organizationId: fixture.organizationId,
      inboxItemId: handled,
      closeReason: 'external_reply_observed',
    })
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await small?.tearDown()
    await fixture?.tearDown()
  })

  test('a manager reads what to fix first and follows it into the Inbox', async ({
    page,
  }) => {
    await signIn(page, fixture.manager.email, fixture.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${fixture.propertyId}/guests`)

    for (const question of [
      'Anything urgent?',
      'Are guests happier lately?',
      'What should we fix first?',
      'What are we doing well?',
    ]) {
      await expect(page.getByRole('heading', { name: question })).toBeVisible({
        timeout: 20_000,
      })
    }
    await expect(page.getByRole('link', { name: /Open the goal/u })).toHaveCount(0)
    await assertNoAxeViolations(page, 'Guest voice check-in (desktop)')
    const opener = page
      .getByRole('button', { name: /Air conditioning.*4 guests/u })
      .first()
    await opener.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('These guests')).toBeVisible()
    await expect(sheet.getByText('Other guests')).toBeVisible()
    // The seeded reviews are quotable: the sheet shows them with the counted-sentence note.
    await expect(sheet.locator('blockquote').first()).toBeVisible()
    await expect(
      sheet.getByText('The underlined sentence is the part we counted.', {
        exact: false,
      }),
    ).toBeVisible()
    await sheet.getByRole('button', { name: /Linked serious concern/u }).click()
    await expect(
      sheet.getByText('Health risk · a guest report, not a verified finding.'),
    ).toBeVisible()
    await sheet.getByRole('button', { name: /Back to Air conditioning/u }).click()
    await expect(sheet.getByText('These guests')).toBeVisible()
    const bookmark = page.url()
    await page.keyboard.press('Escape')
    await expect(opener).toBeFocused()
    await page.goto(bookmark)
    await expect(page.getByRole('dialog').getByText('These guests')).toBeVisible()
    // The default Inbox can omit handled reviews: the action deliberately promises no "all N".
    await clickWhenReady(
      page
        .getByRole('dialog')
        .getByRole('link', { name: /Open these reviews in the Inbox/u })
        .first(),
    )
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

    await expect(
      page.getByRole('heading', { name: 'What should we fix first?' }),
    ).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('button', { name: 'See each month' })).toBeVisible()
    await page.getByRole('button', { name: 'See each month' }).click()
    const months = page.getByRole('group', { name: /Monthly ratings/u })
    await months.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('End')
    await page.getByRole('combobox', { name: 'Time range' }).click()
    await page.getByRole('option', { name: '30 days', exact: true }).click()
    await expect(page).toHaveURL(/range=30d/u)
    await expect(
      page.getByRole('heading', { name: 'What should we fix first?' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: /Air conditioning.*4 guests/u })
      .first()
      .click()
    await page
      .getByRole('dialog')
      .locator('[data-slot="guest-voice-detail-body"]')
      .evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
    const footer = page.getByRole('dialog').locator('[data-slot="sheet-footer"]')
    await expect(
      footer.getByRole('link', { name: /Open these reviews in the Inbox/u }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
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

  test('small properties keep serious concerns above three safe previews', async ({
    page,
  }) => {
    await signIn(page, small.manager.email, small.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${small.propertyId}/guests`)
    await expect(page.getByRole('heading', { name: 'Anything urgent?' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Not enough reviews to spot patterns yet')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'What are guests saying?' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'See all 6 reviews', exact: true }),
    ).toHaveCount(1)
    await expect(
      page.getByRole('heading', { name: 'What should we fix first?' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Invite guests to review' }),
    ).toBeVisible()
    await assertNoAxeViolations(page, 'Small Guest voice with a concern')
  })

  test('topic sheets and missing targets are honest, and range changes clear detail', async ({
    page,
  }) => {
    await signIn(page, fixture.manager.email, fixture.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${fixture.propertyId}/guests?detail=topic:food_drink`)
    await expect(page.getByRole('dialog').getByText('What guests liked')).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByRole('dialog').getByRole('link', { name: /Open these reviews/u }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: '30 days', exact: true }).click()
    await expect(page).toHaveURL(/range=30d/u)
    await expect(page).not.toHaveURL(/detail=/u)
    await page.goto(
      `/properties/${fixture.propertyId}/guests?detail=issue:00000000-0000-4000-8000-000000000000:praise`,
    )
    await expect(
      page
        .getByRole('dialog')
        .getByText('These details are no longer available for this property and period.'),
    ).toBeVisible()
  })

  test('copy summary uses product topics and counts, with no guest words', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await signIn(page, fixture.manager.email, fixture.manager.password, BASE_ORIGIN)
    await page.goto(`/properties/${fixture.propertyId}/guests`)
    await page.getByRole('button', { name: 'Copy team summary' }).click()
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    const note = await page.evaluate(() => navigator.clipboard.readText())
    expect(note).toContain('Guest voice ·')
    expect(note).toContain('What to work on: Facilities and equipment — 4 reviews.')
    expect(note).not.toMatch(/Synthetic reviewer|air conditioning|team_member|https?:/u)
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await assertNoAxeViolations(page, 'Guest voice check-in dark')
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
