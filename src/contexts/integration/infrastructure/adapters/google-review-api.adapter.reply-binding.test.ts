// What binds a Google reply write to its authorization (docs/BETA.md §2, "No
// automated reply publication").
//
// `replyToReview` asks the authorizer for a permit with the reply's own
// coordinates, so a permit that names anything else takes a second bug. The
// adapter's own check (`assertReplyAuthorizationBinds`) is the defence against
// that bug, and a defence nothing exercises can be deleted unnoticed: before
// this file, eleven of its twelve clauses could each be removed with every
// test passing, the capability clause that BETA cites among them.
//
// Each row hands the adapter a permit that differs from the request in exactly
// one bound value. The write must be refused as `authorization_changed`, not
// retryable, before the executor is reached. The control beside the table uses
// the same permit unchanged and must reach the executor, so the table cannot
// pass because the fixture itself is refused.

import { describe, expect, it, vi } from 'vitest'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '../../../../../test-fixtures/generated/google-provider-identifiers-v1'
import type { GoogleReplyPublicationProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter'

const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
const REVIEW_ID = '00000000-0000-4000-8000-000000000005'
const REPLY_ID = '00000000-0000-4000-8000-000000000006'
const REPLY_TEXT = 'thanks'

/** The reply the publish worker is about to write. */
const REQUEST = Object.freeze({
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: 17,
  reviewId: REVIEW_ID,
  materialReviewRevision: 4,
  replyId: REPLY_ID,
  publicationCycle: 2,
  attemptNumber: 1,
  reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  text: REPLY_TEXT,
})

/** The permit that authorizes exactly that write. */
const PERMIT = Object.freeze({
  capability: 'property.publish_reply',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({
    generation: 3,
    propertySourceEpoch: 17,
    publicationCycle: 2,
    publicationAttemptNumber: 1,
    expectedReplyDigest: googleReplyTextDigest(REPLY_TEXT),
  }),
  publication: Object.freeze({
    reviewId: REVIEW_ID,
    replyId: REPLY_ID,
    publicationCycle: 2,
    attemptNumber: 1,
    sourceEpoch: 17,
    materialReviewRevision: 4,
  }),
}) satisfies GoogleReplyPublicationProviderCallAuthorization

const forAnother = (
  publication: Partial<GoogleReplyPublicationProviderCallAuthorization['publication']>,
) => ({ ...PERMIT, publication: { ...PERMIT.publication, ...publication } })

/**
 * One permit per bound value, each wrong in that value only; the capability
 * has a row for each of the three others. A permit of another capability, or
 * one a user started, is not of the reply permit's type: the type is what
 * normally stops it, and this check is what stops it when the type was cast
 * away upstream.
 */
const PERMITS_FOR_SOMETHING_ELSE: ReadonlyArray<readonly [string, object]> = [
  ['the review-sync capability', { ...PERMIT, capability: 'property.connect_gbp' }],
  ['the import capability', { ...PERMIT, capability: 'property.import_gbp_v2' }],
  [
    'the performance capability',
    { ...PERMIT, capability: 'property.read_gbp_performance' },
  ],
  ['a call a user started', { ...PERMIT, initiatorUserId: 'user-1' }],
  [
    'another Organization',
    { ...PERMIT, organizationId: organizationId('1VN1QpEMKOK4zHDfCNFSbRlRzyfs0CvD') },
  ],
  [
    'another Property',
    { ...PERMIT, propertyId: propertyId('00000000-0000-4000-8000-000000000012') },
  ],
  [
    'another Google connection',
    {
      ...PERMIT,
      connectionId: googleConnectionId('00000000-0000-4000-8000-000000000013'),
    },
  ],
  ['another Review', forAnother({ reviewId: '00000000-0000-4000-8000-000000000015' })],
  ['another Reply', forAnother({ replyId: '00000000-0000-4000-8000-000000000016' })],
  ['another publication cycle', forAnother({ publicationCycle: 3 })],
  ['another attempt', forAnother({ attemptNumber: 2 })],
  ['another source epoch', forAnother({ sourceEpoch: 18 })],
  ['another Material Review Revision', forAnother({ materialReviewRevision: 5 })],
  [
    'other reply text',
    {
      ...PERMIT,
      authorizationVector: {
        ...PERMIT.authorizationVector,
        expectedReplyDigest: googleReplyTextDigest('a reply nobody approved'),
      },
    },
  ],
]

/** The adapter, with an authorizer that answers with `permit` whatever it is asked. */
function adapterGiven(permit: object) {
  const execute = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      contentType: 'application/json',
      cacheControl: null,
      retryAfter: null,
      providerCorrelationId: 'provider-request-1',
    },
    body: new TextEncoder().encode('{}'),
  })
  const authorizeReplyPublicationProviderCall = vi
    .fn()
    .mockResolvedValue({ accessToken: 'access-token', authorization: permit })
  const api = createGoogleReviewApiAdapter({
    connectionRepo: {
      findById: vi.fn().mockResolvedValue({ status: 'active' }),
    } as never,
    logger: { warn: vi.fn() } as never,
    cursorStore: {
      redeem: vi.fn(),
      publishNext: vi.fn(),
      discardRun: vi.fn(),
    },
    executor: { execute },
    authorizeReplyPublicationProviderCall,
    nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
  })
  return { api, execute, authorizeReplyPublicationProviderCall }
}

describe('a Google reply write and the permit that authorizes it', () => {
  it('goes out under the permit for exactly this reply', async () => {
    const { api, execute } = adapterGiven(PERMIT)

    await expect(api.replyToReview({ ...REQUEST })).resolves.toEqual({
      providerCorrelationId: 'provider-request-1',
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: 'reviews.reply', comment: REPLY_TEXT }),
      expect.objectContaining({ authorization: PERMIT }),
    )
  })

  it.each(PERMITS_FOR_SOMETHING_ELSE)(
    'is refused before it is sent under a permit for %s',
    async (_what, permit) => {
      const { api, execute, authorizeReplyPublicationProviderCall } = adapterGiven(permit)

      await expect(api.replyToReview({ ...REQUEST })).rejects.toMatchObject({
        _tag: 'GoogleReviewApiError',
        code: 'authorization_changed',
        recoverable: false,
      })
      // The refusal is the adapter's own: the authorizer answered.
      expect(authorizeReplyPublicationProviderCall).toHaveBeenCalledTimes(1)
      expect(execute).not.toHaveBeenCalled()
    },
  )
})
