// Multi-property organizations work the Inbox across every property. The queue
// rail's Properties section is where the scope lives: "All properties" is the
// organization-wide Inbox, a property is its own Reviews page, and the list
// follows the choice. From a page with no property (the properties list), the
// app's Reviews entry opens All properties.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedReview,
  seedReviewInboxItemWithCycle,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-scope-'
const seed = requireE2eSeedState()

test.describe('Critical workflow: inbox property scope', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test.afterAll(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('a manager moves the inbox between all properties and one property', async ({
    page,
  }) => {
    const annexName = `E2E Scope Annex ${e2eRunId}`
    const { propertyId: annexId } = await seedProperty({
      organizationId: seed.organizationId,
      name: annexName,
      slug: `${PREFIX}annex-${e2eRunId}`,
    })
    const mainReviewer = `Scope Main Reviewer ${e2eRunId}`
    const annexReviewer = `Scope Annex Reviewer ${e2eRunId}`
    for (const [propertyId, reviewerName, key] of [
      [seed.propertyId, mainReviewer, 'main'],
      [annexId, annexReviewer, 'annex'],
    ] as const) {
      const { reviewId } = await seedReview({
        organizationId: seed.organizationId,
        propertyId,
        externalId: `${PREFIX}${key}-${e2eRunId}`,
        rating: 2,
        text: `Scope review body for the ${key} property.`,
        reviewerName,
      })
      await seedReviewInboxItemWithCycle({
        organizationId: seed.organizationId,
        propertyId,
        reviewId,
      })
    }

    await signIn(page)
    await page.goto('/inbox')

    const properties = page.getByRole('navigation', { name: 'Properties' })
    const allProperties = properties.getByRole('button', { name: /^All properties/ })
    const annex = properties.getByRole('button', { name: new RegExp(`^${annexName}`) })
    await expect(allProperties).toHaveAttribute('aria-current', 'page', {
      timeout: 15_000,
    })
    await expect(page.getByText(mainReviewer).first()).toBeVisible()
    await expect(page.getByText(annexReviewer).first()).toBeVisible()

    // One click narrows to the property: its own Reviews page, only its work.
    await annex.click()
    await expect(page).toHaveURL(new RegExp(`/properties/${annexId}/reviews`))
    await expect(annex).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText(annexReviewer).first()).toBeVisible()
    await expect(page.getByText(mainReviewer)).toHaveCount(0)

    // And one click widens it again.
    await allProperties.click()
    await expect(page).toHaveURL(/\/inbox(?:\?|$)/)
    await expect(allProperties).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText(mainReviewer).first()).toBeVisible()
    await expect(page.getByText(annexReviewer).first()).toBeVisible()
  })

  test('Reviews opens all properties from a page without a property', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/properties')

    const reviews = page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /^Reviews/ })
    await expect(reviews).toHaveAttribute('href', '/inbox', { timeout: 15_000 })
  })
})
