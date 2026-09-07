// Local-sandbox acceptance for the v2 Google property import contract.
// The browser drives the real server functions, workers, provider gateway,
// provider-ephemeral reference store, Property mutation, review sync, and inbox
// projection. Provider identifiers must never cross the browser boundary.

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubLocation } from '../../fixtures/gbp-stub'
import type {
  ImportAccountPageDto,
  ImportCandidatePageDto,
  ImportProgressDto,
} from '../../../src/contexts/integration/application/public-api'
import {
  drainFixtureQueue,
  e2eRunId,
  cleanupE2eData,
  seedGoogleConnection,
  seedProperty,
  getUserByEmail,
  getPropertyByGbpLocationId,
  getReviewsForProperty,
  getInboxItemForReview,
  callServerFn,
  callServerFnGet,
  waitFor,
  bailWait,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-imp-'
const seed = requireE2eSeedState()
const ACCOUNT = `e2e-imp-${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOC_A = `${ACCOUNT_NAME}/locations/loc-a`
const LOC_B = `${ACCOUNT_NAME}/locations/loc-b`
const TITLE_A = `E2E Imp Hotel One ${e2eRunId}`
const TITLE_B = `E2E Imp Hotel Two ${e2eRunId}`
const SERVER_FILE = 'src/contexts/integration/server/gbp-import.ts'

function location(name: string, title: string): StubLocation {
  return {
    name,
    title,
    storefrontAddress: {
      addressLines: ['1 Main St'],
      locality: 'Springfield',
      administrativeArea: 'IL',
      postalCode: '62701',
      regionCode: 'US',
    },
    categories: { primaryCategory: { displayName: 'Hotel' } },
    latlng: { latitude: 39.1, longitude: -89.6 },
  }
}

function stubLocations(): StubLocation[] {
  return [
    location(LOC_A, TITLE_A),
    location(LOC_B, TITLE_B),
    ...Array.from({ length: 99 }, (_, index) =>
      location(
        `${ACCOUNT_NAME}/locations/filler-${String(index).padStart(3, '0')}`,
        `E2E Import filler ${String(index).padStart(3, '0')} ${e2eRunId}`,
      ),
    ),
  ]
}

async function installPagedProviderScope(): Promise<void> {
  await gbpStubControl.reset()
  await Promise.all([
    gbpStubControl.putScope({
      account: {
        name: ACCOUNT_NAME,
        accountName: `E2E Import account ${e2eRunId}`,
        role: 'OWNER',
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
    }),
    ...Array.from({ length: 20 }, (_, index) =>
      gbpStubControl.putScope({
        account: {
          name: `accounts/aaa-e2e-import-${String(index).padStart(2, '0')}-${e2eRunId}`,
          accountName: `Filler account ${String(index).padStart(2, '0')}`,
          role: 'MANAGER',
        },
        locations: [],
        reviews: {},
      }),
    ),
  ])
}

function assertProviderIdentifiersAbsent(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain('accounts/')
  expect(serialized).not.toContain('/locations/')
  expect(serialized).not.toContain('loc-a')
  expect(serialized).not.toContain('loc-b')
}


test.describe('Critical workflow: Google import + initial sync', () => {
  test.beforeEach(async () => {
    // Stale provider syncs from an earlier spec retry against a stub scope that
    // has moved on, and burn the shared reviews quota this one needs.
    await drainFixtureQueue()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })


  test('pages discovery, imports create + relink, replays exactly, and syncs reviews', async ({
    page,
  }) => {
    // 180s: the import wait below may legitimately consume 90s of it, and
    // discovery, create, relink and replay all run before that. At 120s a slow
    // worker blew the TEST budget instead of the wait's, which reported as a
    // bare Playwright timeout with no import status at all.
    test.setTimeout(180_000)
    await installPagedProviderScope()

    const admin = await getUserByEmail(seed.email)
    expect(admin).toBeTruthy()
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin!.id,
      googleSubject: ACCOUNT,
    })
    const { propertyId: existingPropertyId } = await seedProperty({
      organizationId: seed.organizationId,
      name: `Existing ${TITLE_B}`,
      slug: `${PREFIX}existing-b-${e2eRunId}`,
      googleBinding: {
        connectionId,
        accountId: ACCOUNT,
        locationId: 'loc-b',
        state: 'disconnected',
      },
    })

    await signIn(page)

    const firstAccounts = await callServerFn<ImportAccountPageDto>(page, {
      file: SERVER_FILE,
      exportName: 'listImportAccounts',
      data: { connectionId },
    })
    expect(firstAccounts.items).toHaveLength(20)
    expect(firstAccounts.nextCursor).toBeTruthy()
    expect(
      firstAccounts.items.some((item) => item.displayName.includes('E2E Import')),
    ).toBe(false)
    assertProviderIdentifiersAbsent(firstAccounts)

    const secondAccounts = await callServerFn<ImportAccountPageDto>(page, {
      file: SERVER_FILE,
      exportName: 'listImportAccounts',
      data: { connectionId, cursorRef: firstAccounts.nextCursor },
    })
    expect(secondAccounts.items).toHaveLength(1)
    expect(secondAccounts.nextCursor).toBeNull()
    const importAccount = secondAccounts.items[0]
    expect(importAccount.displayName).toBe(`E2E Import account ${e2eRunId}`)
    assertProviderIdentifiersAbsent(secondAccounts)

    const firstCandidates = await callServerFn<ImportCandidatePageDto>(page, {
      file: SERVER_FILE,
      exportName: 'listImportCandidates',
      data: { connectionId, accountRef: importAccount.accountRef },
    })
    expect(firstCandidates.items).toHaveLength(100)
    expect(firstCandidates.nextCursor).toBeTruthy()
    assertProviderIdentifiersAbsent(firstCandidates)

    const secondCandidates = await callServerFn<ImportCandidatePageDto>(page, {
      file: SERVER_FILE,
      exportName: 'listImportCandidates',
      data: { connectionId, cursorRef: firstCandidates.nextCursor },
    })
    expect(secondCandidates.items).toHaveLength(1)
    expect(secondCandidates.nextCursor).toBeNull()
    assertProviderIdentifiersAbsent(secondCandidates)

    const candidateA = firstCandidates.items.find((item) => item.businessName === TITLE_A)
    const candidateB = firstCandidates.items.find((item) => item.businessName === TITLE_B)
    expect(candidateA?.eligibility.kind).toBe('create')
    expect(candidateB?.eligibility.kind).toBe('relink')
    expect(candidateA?.candidateRef).toBeTruthy()
    expect(candidateB?.candidateRef).toBeTruthy()

    const requestId = randomUUID()
    const request = {
      requestId,
      confirmation: 'apply' as const,
      items: [
        {
          candidateRef: candidateA!.candidateRef!,
          action: 'create' as const,
          profile: {
            name: TITLE_A,
            address: '1 Main St, Springfield, IL 62701',
            countryCode: 'US',
            timezone: 'America/Chicago',
            confirmed: true as const,
          },
        },
        {
          candidateRef: candidateB!.candidateRef!,
          action: 'relink' as const,
          existingPropertyId,
          profile: {
            timezone: 'America/New_York',
            confirmed: true as const,
            updateExistingProfile: false as const,
          },
        },
      ],
    }
    const started = await callServerFn<{
      importJobId: string
      replayed: boolean
      requestId: string
    }>(page, {
      file: SERVER_FILE,
      exportName: 'startPropertyImportV2',
      data: request,
    })
    expect(started).toMatchObject({ replayed: false, requestId })

    // Simulates a dropped start response: the browser repeats the exact request
    // after candidate references have been consumed and receives the receipt.
    const replayed = await callServerFn<{
      importJobId: string
      replayed: boolean
      requestId: string
    }>(page, {
      file: SERVER_FILE,
      exportName: 'startPropertyImportV2',
      data: request,
    })
    expect(replayed).toEqual({
      importJobId: started.importJobId,
      replayed: true,
      requestId,
    })

    const progress = await waitFor(
      async () => {
        const current = await callServerFnGet<ImportProgressDto>(page, {
          file: SERVER_FILE,
          exportName: 'getPropertyImportV2Status',
          data: { importJobId: started.importJobId },
        })
        if (current.status === 'completed') return current
        // Only `queued` and `processing` can still become `completed`. Every
        // other parent status is terminal, so waiting on is waste: report the
        // mismatch now, with the item outcomes that explain it.
        if (current.status !== 'queued' && current.status !== 'processing') {
          bailWait('v2 import', current)
        }
        return null
      },
      {
        // 90s, previously 60s and 30s. This polls a real background worker on a
        // runner already hosting nine containers, so the deadline only bounds
        // how long the worker may take — the assertion is the counts below.
        //
        // The bumps were never the fix, and neither is this one. Six CI
        // failures blamed on a slow worker were actually the import SETTLING at
        // `completed_with_issues` with the relink item cancelled
        // (`authorization_changed`) — a status this wait could never match. The
        // fixes are the two options below: `bailWait` above turns that into an
        // instant, self-explaining failure, and `diagnose` names the state on a
        // genuine timeout.
        timeoutMs: 90_000,
        description: 'v2 import to reach completed',
        diagnose: async () =>
          callServerFnGet<ImportProgressDto>(page, {
            file: SERVER_FILE,
            exportName: 'getPropertyImportV2Status',
            data: { importJobId: started.importJobId },
          }),
      },
    )
    expect(progress.counts.imported).toBe(1)
    expect(progress.counts.relinked).toBe(1)
    expect(progress.totalCount).toBe(2)

    const propertyA = await waitFor(
      () => getPropertyByGbpLocationId(seed.organizationId, 'loc-a'),
      { timeoutMs: 20_000, description: 'imported property loc-a to exist' },
    )
    const propertyB = await waitFor(
      () => getPropertyByGbpLocationId(seed.organizationId, 'loc-b'),
      { timeoutMs: 20_000, description: 'relinked property loc-b to exist' },
    )
    expect(propertyB.id).toBe(existingPropertyId)

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
    for (const review of reviewsA) {
      await waitFor(() => getInboxItemForReview(review.id as string), {
        timeoutMs: 15_000,
        description: `inbox item for review ${review.external_id}`,
      })
    }

    await page.goto('/properties')
    await expect(page.getByText(TITLE_A).first()).toBeVisible()
    await expect(page.getByText(`Existing ${TITLE_B}`).first()).toBeVisible()
    await page.goto(`/properties/${propertyA.id}/reviews`)
    await expect(page.getByText('Import Reviewer A1').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
