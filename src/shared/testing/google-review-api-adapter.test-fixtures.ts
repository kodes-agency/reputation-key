// Shared harness for the Google review API adapter unit suites: the connection
// and authorization the adapter is wired with, the executor answers it reads,
// and the adapter itself.

import { expect, vi, type Mock } from 'vitest'
import { publishReplyToGoogle } from '#/contexts/reputation/publication/publish-reply-to-google.server'
import { translatedGoogleReviewApi } from '#/contexts/reputation/public-api'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from './google-provider-identifiers-v1'
import type { GoogleReviewCursorStore } from '#/contexts/integration/review-sync/google-review-cursor-store.server'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/review-sync/google-review-api.adapter.server'

type AdapterConfig = Parameters<typeof createGoogleReviewApiAdapter>[0]
type AuthorizationOf<
  Authorize extends (...args: never) => Promise<{ authorization: unknown }>,
> = Awaited<ReturnType<Authorize>>['authorization']
type GoogleProviderCallAuthorization =
  | AuthorizationOf<NonNullable<AdapterConfig['authorizeReviewSyncProviderCall']>>
  | AuthorizationOf<NonNullable<AdapterConfig['authorizeReplyPublicationProviderCall']>>

export const ORG_ID = organizationId('0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC')
export const PROPERTY_ID = propertyId('00000000-0000-4000-8000-000000000002')
export const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000003')
export const RUN_ID = '00000000-0000-4000-8000-000000000004'

export const authorization = Object.freeze({
  capability: 'property.connect_gbp',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: null,
  expectedCredentialGeneration: 3,
  authorizationVector: Object.freeze({ generation: 3, propertySourceEpoch: 17 }),
}) satisfies GoogleProviderCallAuthorization

export const publicationAuthorization = Object.freeze({
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
    expectedReplyDigest: googleReplyTextDigest('thanks'),
  }),
  publication: Object.freeze({
    reviewId: '00000000-0000-4000-8000-000000000005',
    replyId: '00000000-0000-4000-8000-000000000006',
    publicationCycle: 2,
    attemptNumber: 1,
    sourceEpoch: 17,
    materialReviewRevision: 4,
  }),
}) satisfies GoogleProviderCallAuthorization

export const connection = {
  status: 'active',
  credentialUseState: 'active',
  lifecycleVersion: 7,
  accessVersion: 11,
  credentialGeneration: 3,
}

export function cursorStore(
  overrides: Partial<GoogleReviewCursorStore> = {},
): GoogleReviewCursorStore {
  return {
    redeem: vi.fn(async () => ({
      ok: true as const,
      value: { pageToken: 'provider-page-token' },
    })),
    release: vi.fn(async () => ({ ok: true as const, value: null })),
    publishNext: vi.fn(async () => ({
      ok: true as const,
      value: { nextCursorRef: `v1.${'a'.repeat(43)}` },
    })),
    discardRun: vi.fn(async () => true),
    startedAtMs: vi.fn(async () => null),
    ...overrides,
  }
}

export function providerReview() {
  return {
    name: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    starRating: 'FIVE',
    comment: 'Excellent stay',
    reviewer: { displayName: 'Guest' },
    createTime: '2026-08-01T10:00:00.000Z',
  }
}

type AnswerOptions = Readonly<{
  retryAfter?: string | null
  contentType?: string | null
  body?: string
  headers?: Readonly<Record<string, string | null>>
}>

/**
 * An answered provider response. Every call gets a fresh body: the adapter
 * zeroes every body it has read.
 */
export function answered(status: number, options: AnswerOptions = {}): Mock {
  const {
    retryAfter = null,
    contentType = 'application/json',
    body = '{"error":{"message":"nope"}}',
    headers = {},
  } = options
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    status,
    headers: { contentType, cacheControl: null, retryAfter, ...headers },
    body: new TextEncoder().encode(body),
  }))
}

/** A 200 JSON answer from the gateway. */
export function jsonAnswer(
  body: unknown,
  options: Pick<AnswerOptions, 'contentType' | 'headers'> = {},
): Mock {
  return answered(200, {
    contentType: 'application/json; charset=utf-8',
    ...options,
    body: JSON.stringify(body),
  })
}

/** The executor refused the call: no provider answer was read. */
export function refused(
  code: string,
  options: Readonly<{
    admissionCode?: string
    dispatch?: 'not_sent' | 'answered'
    retryAfterMs?: number
    providerStatus?: number
  }> = {},
): Mock {
  const {
    admissionCode,
    dispatch = 'not_sent',
    retryAfterMs = 0,
    providerStatus,
  } = options
  return vi.fn().mockResolvedValue({
    ok: false,
    code,
    ...(admissionCode === undefined ? {} : { admissionCode }),
    dispatch,
    ...(providerStatus === undefined ? {} : { providerStatus }),
    retryAfterMs,
  })
}

export function createAdapter(
  input: Readonly<{
    execute: Mock
    cursors?: GoogleReviewCursorStore
    authorizeProviderCall?: Mock
    authorizeReplyPublicationProviderCall?: Mock
    findById?: Mock
  }>,
) {
  const authorizeProviderCall =
    input.authorizeProviderCall ??
    vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      authorization,
    })
  const findById = input.findById ?? vi.fn().mockResolvedValue(connection)
  const authorizeReplyPublicationProviderCall =
    input.authorizeReplyPublicationProviderCall ??
    vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      authorization: publicationAuthorization,
    })
  const warn = vi.fn()
  const adapter = createGoogleReviewApiAdapter({
    connectionRepo: { findById } as never,
    logger: { info: vi.fn(), warn } as never,
    cursorStore: input.cursors ?? cursorStore(),
    executor: { execute: input.execute },
    authorizeReviewSyncProviderCall: authorizeProviderCall,
    authorizeReplyPublicationProviderCall,
    nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
  })
  return {
    // Reads are translated by the Review use cases and the reply write by the
    // reply use case, so the port is seen the way the use cases see it.
    api: {
      ...translatedGoogleReviewApi(adapter),
      replyToReview: publishReplyToGoogle({
        googleReviewApi: adapter,
        connectionStatus: {
          findStatus: async (organizationId, connectionId) =>
            (await findById(organizationId, connectionId))?.status ?? null,
        },
        logger: { warn },
      }),
    },
    adapter,
    authorizeProviderCall,
    authorizeReplyPublicationProviderCall,
    findById,
    warn,
  }
}

export function listInput(cursorRef: string | null = null, pageIndex = 0) {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 17,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    runId: RUN_ID,
    phase: 'main' as const,
    pageIndex,
    cursorRef,
  }
}

export function getReviewInput() {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 17,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  }
}

export function publicationInput() {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 17,
    reviewId: publicationAuthorization.publication.reviewId,
    materialReviewRevision: 4,
    replyId: publicationAuthorization.publication.replyId,
    publicationCycle: 2,
    attemptNumber: 1,
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    text: 'thanks',
  }
}

/** The error a promise rejects with; fails the test when it settles instead. */
export async function settledError(
  promise: Promise<unknown>,
): Promise<Error & { code: string; retryAfterMs?: number }> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(Error)
  return outcome as Error & { code: string; retryAfterMs?: number }
}

/** Case-table rows as `it.each` tuples, so a row's `title` is the test title. */
export function byTitle<Row extends Readonly<{ title: string }>>(
  rows: readonly Row[],
): (readonly [string, Row])[] {
  return rows.map((row) => [row.title, row] as const)
}
