// One journey that fails twice and recovers each time, end to end: Google's
// review reads fail right after a Property is imported, the reviews arrive once
// Google answers again, and the reply a manager approves is then sent with an
// outcome nobody knows, until Google shows it. The Property and its sync are
// made through the import commands; the stub plays Google.
//
// What remains SQL: the Google connection (its tokens come from an OAuth
// consent no test can give).

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubReview } from '../../fixtures/gbp-stub'
import type {
  ImportAccountPageDto,
  ImportCandidatePageDto,
  ImportProgressDto,
} from '../../../src/contexts/integration/application/public-api'
import { callServerFn, callServerFnGet } from '../../helpers/server-fn'
import { cleanupE2eData } from '../../helpers/fixture-cleanup'
import { drainFixtureQueue, enqueueReviewSync } from '../../helpers/fixture-queues'
import { e2eRunId } from '../../helpers/fixture-db'
import {
  getInboxItemForReview,
  getPropertyByGbpLocationId,
  getReplyForReview,
  getReviewsForProperty,
} from '../../helpers/fixture-reads'
import { getUserByEmail, seedGoogleConnection } from '../../helpers/fixture-seeds'
import { waitFor } from '../../helpers/wait-for'
import { expectPhoneLayout } from '../../helpers/phone-layout'

const PREFIX = 'e2e-fail-'
const seed = requireE2eSeedState()
const ACCOUNT = `${PREFIX}${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION_ID = `loc-${e2eRunId}`
const LOCATION_NAME = `${ACCOUNT_NAME}/locations/${LOCATION_ID}`
const TITLE = `E2E Recovery Hotel ${e2eRunId}`
const REVIEW_ID = `fail-r1-${e2eRunId}`
const REVIEW_NAME = `${LOCATION_NAME}/reviews/${REVIEW_ID}`
const REPLY_TEXT = 'Thank you for staying with us, we hope to welcome you back.'

const IMPORT_FILE = 'src/contexts/integration/server/gbp-import.ts'
const PROPERTY_FILE = 'src/contexts/property/server/properties.ts'
const REPLY_FILE = 'src/contexts/review/server/reply-draft.ts'
const REPLY_FILE_OPS = 'src/contexts/review/server/reply.ts'

const stubReview: StubReview = {
  name: REVIEW_NAME,
  starRating: 'FIVE',
  comment: 'Recovery journey review body: a calm stay with a very helpful front desk.',
  reviewer: { displayName: 'Recovery Reviewer' },
  createTime: '2026-07-27T12:00:00Z',
}

const scope = (reviewReply?: StubReview['reviewReply']) =>
  ({
    account: {
      name: ACCOUNT_NAME,
      accountName: `E2E recovery account ${e2eRunId}`,
      role: 'OWNER',
    },
    locations: [
      {
        name: LOCATION_NAME,
        title: TITLE,
        storefrontAddress: {
          addressLines: ['1 Main St'],
          locality: 'Springfield',
          administrativeArea: 'IL',
          postalCode: '62701',
          regionCode: 'US',
        },
        categories: { primaryCategory: { displayName: 'Hotel' } },
        latlng: { latitude: 39.1, longitude: -89.6 },
      },
    ],
    reviews: { [LOCATION_NAME]: [{ ...stubReview, reviewReply }] },
    replyBehavior: { mode: 'fail-then-success', status: 500, failures: 1 },
  }) as const

test.describe('Critical workflow: failures that recover', () => {
  test.beforeEach(async () => {
    await drainFixtureQueue()
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('review reads fail after an import, then an uncertain reply send heals, with no second send', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await gbpStubControl.reset()
    await gbpStubControl.putScope(scope())
    await gbpStubControl.setFetchBehavior(ACCOUNT_NAME, {
      mode: 'always-fail',
      status: 500,
    })

    const admin = await getUserByEmail(seed.email)
    if (!admin) throw new Error('the seeded admin is missing')
    const { connectionId } = await seedGoogleConnection({
      organizationId: seed.organizationId,
      connectedBy: admin.id,
      googleSubject: ACCOUNT,
    })
    await signIn(page)

    // Import the location through the real commands.
    const accounts = await callServerFn<ImportAccountPageDto>(page, {
      file: IMPORT_FILE,
      exportName: 'listImportAccounts',
      data: { connectionId },
    })
    const account = accounts.items.find(
      (item) => item.displayName === `E2E recovery account ${e2eRunId}`,
    )
    if (!account) throw new Error('the stub account is not offered for import')
    const candidates = await callServerFn<ImportCandidatePageDto>(page, {
      file: IMPORT_FILE,
      exportName: 'listImportCandidates',
      data: { connectionId, accountRef: account.accountRef },
    })
    const candidate = candidates.items.find((item) => item.businessName === TITLE)
    if (!candidate?.candidateRef)
      throw new Error('the location is not offered for import')
    const started = await callServerFn<{ importJobId: string }>(page, {
      file: IMPORT_FILE,
      exportName: 'startPropertyImportV2',
      data: {
        requestId: randomUUID(),
        confirmation: 'apply' as const,
        items: [
          {
            candidateRef: candidate.candidateRef,
            action: 'create' as const,
            profile: {
              name: TITLE,
              address: '1 Main St, Springfield, IL 62701',
              countryCode: 'US',
              timezone: 'America/Chicago',
              confirmed: true as const,
            },
          },
        ],
      },
    })
    const property = await waitFor(
      () => getPropertyByGbpLocationId(seed.organizationId, LOCATION_ID),
      { timeoutMs: 60_000, description: 'the imported Property to exist' },
    )
    const propertyId = property.id as string
    await callServerFn(page, {
      file: PROPERTY_FILE,
      exportName: 'updateProperty',
      data: { propertyId, defaultReplyLanguage: 'en-Latn' },
    })

    // Google refuses the review reads: the Property stands, with no reviews, and
    // the import says what it has.
    await waitFor(
      async () => {
        const reads = await gbpStubControl.calls({
          method: 'GET',
          pathPrefix: `/v4/${LOCATION_NAME}/reviews`,
        })
        return reads.length > 0 ? reads : null
      },
      { description: 'a review read was tried and refused' },
    )
    expect(await getReviewsForProperty(propertyId)).toHaveLength(0)
    const status = await callServerFnGet<ImportProgressDto>(page, {
      file: IMPORT_FILE,
      exportName: 'getPropertyImportV2Status',
      data: { importJobId: started.importJobId },
    })
    expect(status.totalCount).toBe(1)

    // Google answers again: the next sync brings the review in.
    await gbpStubControl.setFetchBehavior(ACCOUNT_NAME, { mode: 'success' })
    await enqueueReviewSync({
      propertyId,
      organizationId: seed.organizationId,
      connectionId,
      locationName: LOCATION_NAME,
    })
    const review = await waitFor(
      async () => (await getReviewsForProperty(propertyId))[0] ?? null,
      { timeoutMs: 60_000, description: 'the review to arrive once Google answers' },
    )
    const reviewId = review.id as string
    const inboxItem = await waitFor(() => getInboxItemForReview(reviewId), {
      timeoutMs: 30_000,
      description: 'the arrived review in the Inbox',
    })

    // The reply is approved; Google's first answer is a 500, so the send is
    // uncertain and is only ever read back.
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'draftReplyFn',
      data: { reviewId, text: REPLY_TEXT },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'submitReplyFn',
      data: { reviewId },
    })
    await callServerFn(page, {
      file: REPLY_FILE,
      exportName: 'approveReplyFn',
      data: { reviewId },
    })
    await waitFor(
      async () => {
        const reply = await getReplyForReview(reviewId)
        return reply?.publication_state === 'sending' &&
          Number(reply.publication_attempts) === 1
          ? reply
          : null
      },
      { description: 'the approved reply to be sent once, outcome unknown' },
    )
    const sentOnce = await gbpStubControl.calls({
      method: 'PUT',
      pathPrefix: `/v4/${LOCATION_NAME}`,
    })
    expect(sentOnce).toHaveLength(1)

    // Google shows the reply after all: checking heals it, and nothing is sent again.
    await gbpStubControl.putScope(
      scope({ comment: REPLY_TEXT, updateTime: '2026-07-28T08:00:00Z' }),
    )
    await waitFor(
      async () => {
        try {
          await callServerFn(page, {
            file: REPLY_FILE_OPS,
            exportName: 'checkReplyPublicationFn',
            data: { reviewId },
          })
        } catch (error) {
          // The reads share one provider quota with the whole suite.
          if (/couldn't reach Google to check this reply/i.test(String(error))) {
            return null
          }
          throw error
        }
        const reply = await getReplyForReview(reviewId)
        return reply?.status === 'published' ? reply : null
      },
      { timeoutMs: 60_000, description: 'the uncertain reply to heal to published' },
    )
    expect(
      await gbpStubControl.calls({ method: 'PUT', pathPrefix: `/v4/${LOCATION_NAME}` }),
    ).toHaveLength(1)

    await page.goto(`/inbox?propertyId=${propertyId}&itemId=${inboxItem.id as string}`)
    await expect(page.getByText('Live on Google', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })
    await expectPhoneLayout(page)
  })
})
