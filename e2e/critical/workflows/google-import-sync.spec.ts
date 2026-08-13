// BQC-6.5 item 3 — Google connection/import/sync through the deterministic
// provider contract (the real adapters against the GBP stub; no fakes).
//
// Chain driven end-to-end: fixture-seeded ACTIVE connection →
// startPropertyImport (server fn RPC) → worker import-property job →
// property rows + property.created → initial sync-property-reviews job →
// stub reviews upserted → review.created → inbox projection.
//
// Transitions verified: import job completes, properties exist, the scripted
// reviews are in the DB with their inbox items, and the imported properties
// render in the UI with their review content.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubLocation } from '../../fixtures/gbp-stub'
import {
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  getUserByEmail,
  getPropertyByGbpPlaceId,
  getReviewsForProperty,
  getInboxItemForReview,
  callServerFn,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-imp-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-imp-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOC_A = `${ACCOUNT_NAME}/locations/loc-a`
const LOC_B = `${ACCOUNT_NAME}/locations/loc-b`
const TITLE_A = `E2E Imp Hotel One ${e2eRunId}`
const TITLE_B = `E2E Imp Hotel Two ${e2eRunId}`

function stubLocations(): StubLocation[] {
  const address = {
    addressLines: ['1 Main St'],
    locality: 'Springfield',
    administrativeArea: 'IL',
    postalCode: '62701',
    regionCode: 'US',
  }
  const categories = { primaryCategory: { displayName: 'Hotel' } }
  const latlng = { latitude: 39.1, longitude: -89.6 }
  return [
    { name: LOC_A, title: TITLE_A, storefrontAddress: address, categories, latlng },
    { name: LOC_B, title: TITLE_B, storefrontAddress: address, categories, latlng },
  ]
}

test.describe('Critical workflow: Google import + initial sync', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('import creates properties and initial sync lands reviews + inbox items', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Script the provider: 1 account, 2 locations, review set A (2 + 1).
    await gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        type: 'LOCATION_GROUP',
        roleInfo: { name: 'OWNER' },
      },
      locations: stubLocations(),
      reviews: {
        [LOC_A]: [
          {
            name: `${LOC_A}/reviews/imp-a1`,
            starRating: 'FIVE',
            comment: 'Import sync review A1 body',
            reviewer: { displayName: 'Import Reviewer A1' },
            createTime: '2026-07-20T10:00:00Z',
          },
          {
            name: `${LOC_A}/reviews/imp-a2`,
            starRating: 'FOUR',
            comment: 'Import sync review A2 body',
            reviewer: { displayName: 'Import Reviewer A2' },
            createTime: '2026-07-21T10:00:00Z',
          },
        ],
        [LOC_B]: [
          {
            name: `${LOC_B}/reviews/imp-b1`,
            starRating: 'THREE',
            comment: 'Import sync review B1 body',
            reviewer: { displayName: 'Import Reviewer B1' },
            createTime: '2026-07-22T10:00:00Z',
          },
        ],
      },
    })

    const admin = await getUserByEmail(seed.email)
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleAccountId: ACCOUNT,
    })

    await signIn(page)

    // Drive the import through the real server fn (the /import UI's terminal
    // action): startPropertyImport enqueues the worker job.
    const started = await callServerFn<{
      job: { id: string }
      skippedLocations: unknown[]
    }>(page, {
      file: 'src/contexts/integration/server/gbp-import.ts',
      exportName: 'startPropertyImport',
      data: {
        connectionId,
        locations: [
          {
            gbpPlaceId: 'loc-a',
            businessName: TITLE_A,
            address: '1 Main St, Springfield IL 62701',
            primaryCategory: 'Hotel',
            gbpLocationName: LOC_A,
            gbpLocationId: 'loc-a',
            countryCode: 'US',
          },
          {
            gbpPlaceId: 'loc-b',
            businessName: TITLE_B,
            address: '1 Main St, Springfield IL 62701',
            primaryCategory: 'Hotel',
            gbpLocationName: LOC_B,
            gbpLocationId: 'loc-b',
            countryCode: 'US',
          },
        ],
      },
    })
    expect(started.job.id).toBeTruthy()
    expect(started.skippedLocations).toHaveLength(0)

    // The import job completes (worker) — polled through the app's own status fn.
    await waitFor(
      async () => {
        const status = await callServerFn<{ job: { status: string } }>(page, {
          file: 'src/contexts/integration/server/gbp-import.ts',
          exportName: 'getImportStatus',
          data: { importId: started.job.id },
        })
        return status.job.status === 'completed' ? status : null
      },
      { timeoutMs: 30_000, description: 'import job to reach completed' },
    )

    // Properties created by the worker; initial sync (property.created →
    // sync-property-reviews) lands the scripted reviews + inbox projections.
    const propertyA = await waitFor(
      () => getPropertyByGbpPlaceId(seed.organizationId, 'loc-a'),
      { timeoutMs: 20_000, description: 'imported property loc-a to exist' },
    )
    const propertyB = await waitFor(
      () => getPropertyByGbpPlaceId(seed.organizationId, 'loc-b'),
      { timeoutMs: 20_000, description: 'imported property loc-b to exist' },
    )

    const reviewsA = await waitFor(
      async () => {
        const rows = await getReviewsForProperty(propertyA.id as string)
        return rows.length === 2 ? rows : null
      },
      { timeoutMs: 30_000, description: '2 synced reviews on property A' },
    )
    await waitFor(
      async () => {
        const rows = await getReviewsForProperty(propertyB.id as string)
        return rows.length === 1 ? rows : null
      },
      { timeoutMs: 30_000, description: '1 synced review on property B' },
    )

    // Inbox projections exist for every synced review (review.created chain).
    for (const review of reviewsA) {
      await waitFor(() => getInboxItemForReview(review.id as string), {
        timeoutMs: 15_000,
        description: `inbox item for review ${review.external_id}`,
      })
    }

    // UI: the imported properties render with their review content.
    await page.goto('/properties')
    await expect(page.getByText(TITLE_A).first()).toBeVisible()
    await expect(page.getByText(TITLE_B).first()).toBeVisible()
    await page.goto(`/properties/${propertyA.id}/reviews`)
    await expect(page.getByText('Import Reviewer A1').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
