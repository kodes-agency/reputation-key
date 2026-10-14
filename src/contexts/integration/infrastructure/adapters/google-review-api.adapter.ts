import { z } from 'zod/v4'
import type {
  GoogleReviewApiError,
  GoogleReviewApiPort,
  StarRating,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewRead } from '#/contexts/review/application/ports/google-review-api.port'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import type { OrganizationId, GoogleConnectionId, PropertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import type {
  GoogleProviderCallAuthorization,
  GoogleReplyPublicationProviderCallAuthorization,
  GoogleReviewSyncProviderCallAuthorization,
} from '../../application/google-provider-contract'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import {
  parseReviewProviderResource,
  type ReviewProviderResource,
} from '#/shared/review-provider-subject-contract'
import {
  parseGoogleReplyComment,
  parseGoogleReviewComment,
} from '#/shared/google-review-comment'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import {
  executeGoogleProviderJson,
  executeGoogleProviderRaw,
  gatewayFailureError,
  providerStatusError,
} from './google-provider-adapter'
import {
  cursorFailureCode,
  executorErrorToReviewApiError,
  invalidRequest,
  isAcceptedNonJsonWrite,
  isGoogleReviewApiError,
  replyAuthorizationRefusal,
  reviewApiError,
} from './google-review-api-errors'
import {
  googleReviewCursorAuthorization,
  sameGoogleReviewCursorAuthorization,
  type GoogleReviewCursorAuthorization,
  type GoogleReviewCursorStore,
} from '../google-review-cursor-store'

const PAGE_SIZE = 50
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/iu
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

const STAR_RATING_MAP: Readonly<Record<string, StarRating | undefined>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

// Provider payloads are not our transport: Google adds response fields without
// notice, and rejecting an otherwise valid page for carrying one is a sync
// outage, not a safety property. A real closed-beta page arrived with
// `reviewId`, `updateTime` and `reviewReplyUrl` per review plus a top-level
// `averageRating`; `.strict()` turned all of it into `malformed_response` →
// `malformed_page`, and the property synced zero reviews. Unknown keys are
// dropped (zod's default strip) so nothing unmodelled reaches the domain, while
// every field we do read stays fully validated. The sibling Google adapters
// (gbp-api, google-business-information) already tolerate unknown keys.
const gbpReviewItemSchema = z.object({
  name: z.string().min(1).max(1_024),
  starRating: z.string(),
  comment: z.string().optional(),
  reviewer: z
    .object({
      displayName: z.string().optional(),
      profilePhotoUrl: z.string().optional(),
    })
    .optional(),
  reviewReply: z
    .object({
      comment: z.string().optional(),
      updateTime: z.string().optional(),
    })
    .optional(),
  createTime: z.string().min(1).max(64),
  updateTime: z.string().min(1).max(64).optional(),
})

const gbpReviewsPageSchema = z
  .object({
    reviews: z.array(gbpReviewItemSchema).max(PAGE_SIZE).optional(),
    // Google OMITS this field for a location with no reviews — the response
    // body is `{}`, not `{totalReviewCount: 0}`. Requiring it turned "this
    // location has no reviews" into `malformed_page`, which fails the whole
    // snapshot run rather than recording an empty result. Observed live on
    // 2026-09-02 for every property in the closed beta:
    //   Google reviews page rejected by schema keys=[]
    //     issues=["totalReviewCount:invalid_type"]
    // and `sync-property-reviews` never completed a single run in this
    // deployment's history as a result.
    //
    // Absent therefore means zero, which is the reading the rest of this
    // schema already assumes: the refinement below has always handled
    // `totalReviewCount === 0`, so a zero page was expected as a value and
    // simply never arrived as one.
    totalReviewCount: z.number().int().safe().nonnegative().default(0),
    averageRating: z.number().finite().min(0).max(5).optional(),
    nextPageToken: z.string().min(1).max(2_048).optional(),
  })
  .superRefine((page, context) => {
    if (page.totalReviewCount === 0) {
      if (page.averageRating !== undefined && page.averageRating !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['averageRating'],
          message: 'A zero-review page cannot carry a non-zero average',
        })
      }
      return
    }
    if (page.averageRating === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['averageRating'],
        message: 'A non-empty review snapshot requires the provider average',
      })
    }
  })

type GbpReviewItem = z.infer<typeof gbpReviewItemSchema>

type GoogleReviewApiAdapterDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  logger: LoggerPort
  cursorStore: GoogleReviewCursorStore
  executor: GoogleAuthorizedProviderExecutor
  authorizeReviewSyncProviderCall?: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
    }>,
  ) => Promise<
    Readonly<{
      accessToken: string
      authorization: GoogleReviewSyncProviderCallAuthorization
    }>
  >
  authorizeReplyPublicationProviderCall?: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
      reviewId: string
      materialReviewRevision: number
      replyId: string
      publicationCycle: number
      attemptNumber: number
    }>,
  ) => Promise<
    Readonly<{
      accessToken: string
      authorization: GoogleReplyPublicationProviderCallAuthorization
    }>
  >
  nowMs?: () => number
}>

type ProviderContext = Readonly<{
  accessToken: string
  authorization: GoogleProviderCallAuthorization
  cursorAuthorization: GoogleReviewCursorAuthorization
}>

function withTimeout(ms: number): Readonly<{
  signal: AbortSignal
  clear: () => void
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

// Cursor-store rejections are the one failure class that used to leave no
// trace: every store code is mapped through `cursorFailureCode` here and the
// sync use case collapses the result again into a single `cursor_failure`. A
// closed-beta run applied 6 pages / 256 reviews and then died with that code
// and nothing else on record. Callers therefore report the raw store outcome
// before the mapped error is thrown.
type CursorRejectionOperation =
  'redeem' | 'publish_next' | 'discard_run' | 'discard_cursors'

async function callCursorStore<T>(
  call: () => Promise<T>,
  onFault: () => void,
): Promise<T> {
  try {
    return await call()
  } catch {
    onFault()
    throw reviewApiError('provider_unavailable', true)
  }
}

function exactKeys(input: object, expected: readonly string[]): boolean {
  const actual = Object.keys(input).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function isSafeScopeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:@/-]{1,255}$/u.test(value)
}

function isCountAtLeast(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum
}

type GoogleReplyPublicationInput = Parameters<GoogleReviewApiPort['replyToReview']>[0]
type GoogleReplyPublicationOutcome = Awaited<
  ReturnType<GoogleReviewApiPort['replyToReview']>
>

const REPLY_PUBLICATION_KEYS = [
  'organizationId',
  'propertyId',
  'connectionId',
  'sourceEpoch',
  'reviewId',
  'materialReviewRevision',
  'replyId',
  'publicationCycle',
  'attemptNumber',
  'reviewName',
  'text',
] as const

/**
 * Request-shape validation for a reply publication. Every rule is independent
 * of the others and every failure is the same refusal, so the list stays flat.
 * The text rule is the one the route catalogue compiles `reviews.reply` with
 * (bytes, not UTF-16 units; \n \r \t allowed): a character-count cap here let
 * 2,049 Cyrillic characters through to a compile refusal.
 */
function assertValidReplyPublicationInput(input: GoogleReplyPublicationInput): void {
  if (
    !exactKeys(input, REPLY_PUBLICATION_KEYS) ||
    !isSafeScopeId(input.organizationId) ||
    !isCanonicalUuid(input.propertyId) ||
    !isCanonicalUuid(input.connectionId) ||
    !isCanonicalUuid(input.reviewId) ||
    !isCanonicalUuid(input.replyId) ||
    !isCountAtLeast(input.sourceEpoch, 0) ||
    !isCountAtLeast(input.materialReviewRevision, 1) ||
    !isCountAtLeast(input.publicationCycle, 1) ||
    !isCountAtLeast(input.attemptNumber, 1) ||
    typeof input.text !== 'string' ||
    replyCommentProblem(input.text) !== null
  ) {
    throw invalidRequest()
  }
  try {
    parseReviewProviderResource(input.reviewName)
  } catch {
    throw invalidRequest()
  }
}

/**
 * The issued authorization must pin every dimension of the reply about to be
 * published, including the exact reply text via its digest.
 */
function assertReplyAuthorizationBinds(
  authorization: GoogleReplyPublicationProviderCallAuthorization,
  input: GoogleReplyPublicationInput,
): void {
  const publication = authorization.publication
  if (
    authorization.capability !== 'property.publish_reply' ||
    authorization.initiatorUserId !== null ||
    authorization.organizationId !== input.organizationId ||
    authorization.propertyId !== input.propertyId ||
    authorization.connectionId !== input.connectionId ||
    publication.reviewId !== input.reviewId ||
    publication.replyId !== input.replyId ||
    publication.publicationCycle !== input.publicationCycle ||
    publication.attemptNumber !== input.attemptNumber ||
    publication.sourceEpoch !== input.sourceEpoch ||
    publication.materialReviewRevision !== input.materialReviewRevision ||
    googleReplyTextDigest(input.text) !==
      authorization.authorizationVector.expectedReplyDigest
  ) {
    throw reviewApiError('authorization_changed', false)
  }
}

function assertLocationName(locationName: string): void {
  try {
    parseReviewProviderResource(`${locationName}/reviews/validation`)
  } catch {
    throw invalidRequest()
  }
}

function assertReviewName(reviewName: string, locationName: string): void {
  try {
    parseReviewProviderResource(reviewName)
  } catch {
    throw invalidRequest()
  }
  if (!reviewName.startsWith(`${locationName}/reviews/`)) {
    throw invalidRequest()
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw reviewApiError('malformed_response', false)
  return parsed
}

function mapReview(
  raw: GbpReviewItem,
  locationName: string,
): GoogleReviewRead & Readonly<{ replyUnreadable: boolean }> {
  let resource: ReviewProviderResource
  try {
    resource = parseReviewProviderResource(raw.name)
  } catch {
    throw reviewApiError('malformed_response', false)
  }
  if (
    `accounts/${resource.accountId}/locations/${resource.locationId}` !== locationName
  ) {
    throw reviewApiError('malformed_response', false)
  }
  const rating = STAR_RATING_MAP[raw.starRating]
  if (!rating) throw reviewApiError('malformed_response', false)
  // Google ships the machine translation and the guest's own words glued into
  // one `comment` field. `text` must be the original: language detection and the
  // whole AI reply plane read it, and the blob made 8 Bulgarian reviews look
  // like reliable English.
  const comment = parseGoogleReviewComment(raw.comment)
  const reply = parseGoogleReplyComment(raw.reviewReply?.comment)
  return {
    reviewName: raw.name,
    externalId: resource.reviewId,
    externalLocationId: locationName,
    reviewerName: raw.reviewer?.displayName ?? null,
    reviewerProfilePhotoUrl: raw.reviewer?.profilePhotoUrl ?? null,
    rating,
    text: comment.original,
    translatedText: comment.translation,
    languageCode: null,
    reviewedAt: parseDate(raw.createTime),
    sourceCreatedAt: parseDate(raw.createTime),
    sourceUpdatedAt: raw.updateTime ? parseDate(raw.updateTime) : null,
    // Google wraps an echoed reply in the same translation envelope it wraps
    // review text in - `(Translated by Google) <en>\n\n(Original)\n<src>` -
    // whenever the reply language differs from the reader locale. The review
    // text two lines above is already split; the reply was not, so the digest
    // of the whole blob never matched the digest of what we sent. Measured on
    // the beta property: a Bulgarian reply that Google had published at
    // 09:01:28Z could not be confirmed, so it settled as "Google status
    // unconfirmed" and no reply on a translated review could ever reach
    // Published.
    replyText: reply.text,
    // A reply Google shows without a recoverable original (translation-only
    // envelope) is not "no reply": reconciliation must not read it as absent.
    replyUnreadable: reply.unreadable,
    replyUpdatedAt: raw.reviewReply?.updateTime
      ? parseDate(raw.reviewReply.updateTime)
      : null,
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw reviewApiError('malformed_response', false)
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(decoded)
  } catch {
    throw reviewApiError('malformed_response', false)
  }
}

export const createGoogleReviewApiAdapter = (
  deps: GoogleReviewApiAdapterDeps,
): GoogleReviewApiPort => {
  const nowMs = deps.nowMs ?? Date.now

  // Stable, bounded, content-free: identifiers and codes only. Never the page
  // token, never the cursor ref, never review content — a diagnostic that
  // leaks the opaque-reference indirection is worse than no diagnostic. `code`
  // is the raw store outcome, not `cursorFailureCode`'s mapping, because
  // `conflict` and `unavailable` both collapse onto `provider_unavailable`.
  const logCursorRejection = (
    entry: Readonly<{
      operation: CursorRejectionOperation
      code: string
      phase: 'main' | 'confirmation' | null
      pageIndex: number | null
      runId: string
      /** Publication only: which `binding_mismatch` branch the store took. */
      parentCursorRefPresent?: boolean
      nextPageIndex?: number
    }>,
  ): void => {
    deps.logger.warn(
      { event: 'reviews_cursor_rejected', ...entry },
      'Google reviews cursor store rejected the call',
    )
  }

  const resolveProviderContext = async (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
    }>,
  ): Promise<ProviderContext> => {
    if (!deps.authorizeReviewSyncProviderCall) {
      throw reviewApiError('provider_unavailable', true)
    }
    const { accessToken, authorization } = await deps.authorizeReviewSyncProviderCall({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
    })
    const connection = await deps.connectionRepo.findById(
      input.organizationId,
      input.connectionId,
    )
    if (
      !connection ||
      connection.status !== 'active' ||
      connection.credentialUseState !== 'active' ||
      authorization.capability !== 'property.connect_gbp' ||
      authorization.initiatorUserId !== null ||
      authorization.organizationId !== input.organizationId ||
      authorization.propertyId !== input.propertyId ||
      authorization.connectionId !== input.connectionId ||
      authorization.authorizationVector.propertySourceEpoch !== input.sourceEpoch ||
      authorization.expectedCredentialGeneration !== connection.credentialGeneration
    ) {
      throw reviewApiError('authorization_changed', false)
    }
    return {
      accessToken,
      authorization,
      cursorAuthorization: googleReviewCursorAuthorization(connection, authorization),
    }
  }

  const assertAuthorizationCurrent = async (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
    }>,
    expected: GoogleReviewCursorAuthorization,
  ): Promise<void> => {
    const current = await resolveProviderContext(input)
    if (!sameGoogleReviewCursorAuthorization(current.cursorAuthorization, expected)) {
      throw reviewApiError('authorization_changed', false)
    }
  }

  const requestJson = async (
    operation: string,
    descriptor: GoogleProviderRouteDescriptor,
    context: ProviderContext,
  ): Promise<unknown> => {
    try {
      return await trace(`googleReviewApi.${operation}`, () =>
        executeGoogleProviderJson({
          operation,
          descriptor,
          authorization: context.authorization,
          executor: deps.executor,
          nowMs,
        }),
      )
    } catch (error) {
      throw executorErrorToReviewApiError(error)
    }
  }

  const listReviewsPage: GoogleReviewApiPort['listReviewsPage'] = async (input) => {
    if (
      !exactKeys(input, [
        'organizationId',
        'propertyId',
        'connectionId',
        'sourceEpoch',
        'locationName',
        'runId',
        'phase',
        'pageIndex',
        'cursorRef',
      ]) ||
      !isSafeScopeId(input.organizationId) ||
      !isCanonicalUuid(input.propertyId) ||
      !isCanonicalUuid(input.connectionId) ||
      !isCanonicalUuid(input.runId) ||
      !Number.isSafeInteger(input.sourceEpoch) ||
      input.sourceEpoch < 0 ||
      !Number.isInteger(input.pageIndex) ||
      input.pageIndex < 0 ||
      input.pageIndex > 199 ||
      (input.phase !== 'main' && input.phase !== 'confirmation') ||
      (input.cursorRef !== null &&
        !/^[a-z][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{43}$/u.test(input.cursorRef))
    ) {
      throw invalidRequest()
    }
    assertLocationName(input.locationName)
    const context = await resolveProviderContext(input)
    const scope = {
      organizationId: String(input.organizationId),
      propertyId: String(input.propertyId),
      connectionId: String(input.connectionId),
      sourceEpoch: input.sourceEpoch,
      locationName: input.locationName,
      runId: input.runId,
      phase: input.phase,
      pageIndex: input.pageIndex,
    } as const
    const cursorDiagnostic = {
      phase: input.phase,
      pageIndex: input.pageIndex,
      runId: input.runId,
    } as const
    let pageToken: string | undefined
    const cursorRef = input.cursorRef
    if (cursorRef) {
      const redeemed = await callCursorStore(
        () =>
          deps.cursorStore.redeem({
            cursorRef,
            scope,
            authorization: context.cursorAuthorization,
          }),
        () =>
          logCursorRejection({
            operation: 'redeem',
            code: 'store_threw',
            ...cursorDiagnostic,
          }),
      )
      if (!redeemed.ok) {
        logCursorRejection({
          operation: 'redeem',
          code: redeemed.code,
          ...cursorDiagnostic,
        })
        throw reviewApiError(
          cursorFailureCode(redeemed.code),
          redeemed.code === 'conflict' || redeemed.code === 'unavailable',
        )
      }
      pageToken = redeemed.value.pageToken
    }
    const raw = await requestJson(
      'reviews.list',
      {
        routeKey: 'reviews.list',
        accessToken: context.accessToken,
        locationName: input.locationName,
        ...(pageToken ? { pageToken } : {}),
      },
      context,
    )
    await assertAuthorizationCurrent(input, context.cursorAuthorization)
    const parsed = gbpReviewsPageSchema.safeParse(raw)
    if (!parsed.success) {
      // Shape only — key names and zod issue paths/codes, never values. A page
      // the provider considers well-formed must never be indistinguishable
      // from a transport fault in the logs.
      deps.logger.warn(
        {
          event: 'reviews_page_rejected',
          keys:
            typeof raw === 'object' && raw !== null
              ? Object.keys(raw).sort()
              : typeof raw,
          issues: parsed.error.issues
            .slice(0, 12)
            .map((issue) =>
              issue.code === 'unrecognized_keys'
                ? `${issue.path.join('.') || '<root>'}:unrecognized:${issue.keys.join('|')}`
                : `${issue.path.join('.') || '<root>'}:${issue.code}`,
            ),
        },
        'Google reviews page rejected by schema',
      )
      throw reviewApiError('malformed_response', false)
    }
    const reviews =
      parsed.data.reviews?.map((review) => mapReview(review, input.locationName)) ?? []
    let nextCursorRef: string | null = null
    const nextPageToken = parsed.data.nextPageToken
    if (nextPageToken) {
      if (input.pageIndex === 199) throw reviewApiError('malformed_response', false)
      const published = await callCursorStore(
        () =>
          deps.cursorStore.publishNext({
            parentCursorRef: input.cursorRef,
            scope,
            nextScope: { ...scope, pageIndex: input.pageIndex + 1 },
            authorization: context.cursorAuthorization,
            nextPageToken,
          }),
        () =>
          logCursorRejection({
            operation: 'publish_next',
            code: 'store_threw',
            ...cursorDiagnostic,
          }),
      )
      if (!published.ok) {
        logCursorRejection({
          operation: 'publish_next',
          code: published.code,
          // `binding_mismatch` has three distinct causes inside the store: a
          // scope field diverging, a null parent ref anywhere but page 0, and a
          // next page index that is not scope + 1. The code alone cannot tell
          // them apart, so carry the two the adapter controls.
          parentCursorRefPresent: input.cursorRef !== null,
          nextPageIndex: input.pageIndex + 1,
          ...cursorDiagnostic,
        })
        throw reviewApiError(
          cursorFailureCode(published.code),
          published.code === 'conflict' || published.code === 'unavailable',
        )
      }
      nextCursorRef = published.value.nextCursorRef
    }
    return {
      reviews,
      totalReviewCount: parsed.data.totalReviewCount,
      averageRating:
        parsed.data.totalReviewCount === 0 ? null : parsed.data.averageRating!,
      nextCursorRef,
    }
  }

  // Accepted residual: a provider-boundary reader that must not trust anything
  // it is handed. The code paths are an exact-key check, six identifier/range
  // validations, and per-status provider error mapping — each one a distinct
  // way Google or a caller can be wrong, and every one has to stay ahead of
  // the parse. Revisit if the validation ladder is ever shared with
  // listReviewsPage and reviews.reply — three copies would justify a
  // validated-input type that all three parse into once.
  // fallow-ignore-next-line complexity
  const getReview: GoogleReviewApiPort['getReview'] = async (input) => {
    if (
      !exactKeys(input, [
        'organizationId',
        'propertyId',
        'connectionId',
        'sourceEpoch',
        'locationName',
        'reviewName',
      ]) ||
      !isSafeScopeId(input.organizationId) ||
      !isCanonicalUuid(input.propertyId) ||
      !isCanonicalUuid(input.connectionId) ||
      !Number.isSafeInteger(input.sourceEpoch) ||
      input.sourceEpoch < 0
    ) {
      throw invalidRequest()
    }
    assertLocationName(input.locationName)
    assertReviewName(input.reviewName, input.locationName)
    const context = await resolveProviderContext(input)
    let raw: unknown
    const timeout = withTimeout(30_000)
    try {
      const result = await deps.executor.execute(
        {
          routeKey: 'reviews.get',
          accessToken: context.accessToken,
          reviewName: input.reviewName,
        },
        {
          authorization: context.authorization,
          deadlineMs: nowMs() + 30_000,
          signal: timeout.signal,
        },
      )
      // The same error vocabulary as the list route: the snapshot confirmation
      // retries by code alone and waits only as long as the hint, so a refusal
      // that is named a retryable outage, or an outage that carries no wait,
      // is re-run at queue speed until the run expires.
      if (!result.ok) {
        throw executorErrorToReviewApiError(gatewayFailureError('getReview', result))
      }
      if (result.status === 404) {
        result.body.fill(0)
        await assertAuthorizationCurrent(input, context.cursorAuthorization)
        return { status: 'not_found' }
      }
      if (result.status !== 200) {
        result.body.fill(0)
        throw executorErrorToReviewApiError(
          providerStatusError('getReview', result, nowMs, nowMs()),
        )
      }
      if (
        !result.headers.contentType ||
        !JSON_CONTENT_TYPE.test(result.headers.contentType)
      ) {
        result.body.fill(0)
        throw reviewApiError('provider_unavailable', true)
      }
      try {
        raw = parseJsonBytes(result.body)
      } finally {
        result.body.fill(0)
      }
    } catch (error) {
      if (isGoogleReviewApiError(error)) throw error
      throw reviewApiError('provider_unavailable', true)
    } finally {
      timeout.clear()
    }
    await assertAuthorizationCurrent(input, context.cursorAuthorization)
    const parsed = gbpReviewItemSchema.safeParse(raw)
    if (!parsed.success) throw reviewApiError('malformed_response', false)
    return { status: 'found', review: mapReview(parsed.data, input.locationName) }
  }

  const discardReviewCursors: GoogleReviewApiPort['discardReviewCursors'] = async (
    input,
  ) => {
    if (
      !exactKeys(input, ['organizationId', 'propertyId', 'sourceEpoch', 'runId']) ||
      !isSafeScopeId(input.organizationId) ||
      !isCanonicalUuid(input.propertyId) ||
      !isCanonicalUuid(input.runId) ||
      !Number.isSafeInteger(input.sourceEpoch) ||
      input.sourceEpoch < 0
    ) {
      throw invalidRequest()
    }
    // Two distinct rejections live here: the port-level call can fault before
    // the store ever answers (`discard_cursors`), or the store can answer no
    // (`discard_run`). `discardRun` returns a bare boolean, so `rejected` is
    // the only code it can report.
    const discarded = await callCursorStore(
      () =>
        deps.cursorStore.discardRun({
          organizationId: String(input.organizationId),
          propertyId: String(input.propertyId),
          sourceEpoch: input.sourceEpoch,
          runId: input.runId,
        }),
      () =>
        logCursorRejection({
          operation: 'discard_cursors',
          code: 'store_threw',
          phase: null,
          pageIndex: null,
          runId: input.runId,
        }),
    )
    if (!discarded) {
      logCursorRejection({
        operation: 'discard_run',
        code: 'rejected',
        phase: null,
        pageIndex: null,
        runId: input.runId,
      })
      throw reviewApiError('provider_unavailable', true)
    }
  }

  /**
   * A reply refused while its connection waits for an AccountAdmin to
   * reconnect Google is the reconnect case, not a changed approval, so the
   * publish job can tell its author so. An unreadable connection keeps the
   * refusal as it was; both codes are terminal.
   */
  const withReauthorizationCause = async (
    input: GoogleReplyPublicationInput,
    refusal: GoogleReviewApiError,
  ): Promise<GoogleReviewApiError> => {
    if (refusal.code !== 'authorization_changed') return refusal
    let status: string | null
    try {
      const connection = await deps.connectionRepo.findById(
        input.organizationId,
        input.connectionId,
      )
      status = connection?.status ?? null
    } catch {
      deps.logger.warn(
        { event: 'google_reply_refusal_connection_unreadable' },
        'Google reply refusal kept its code; the connection could not be read',
      )
      return refusal
    }
    if (status !== 'reauth_required') return refusal
    return reviewApiError(
      'reauthorization_required',
      false,
      refusal.failure === undefined ? {} : { failure: refusal.failure },
    )
  }

  const replyViaExecutor = async (
    input: GoogleReplyPublicationInput,
  ): Promise<GoogleReplyPublicationOutcome> => {
    if (!deps.authorizeReplyPublicationProviderCall) {
      throw reviewApiError('provider_unavailable', false)
    }
    let authorized: Awaited<
      ReturnType<NonNullable<typeof deps.authorizeReplyPublicationProviderCall>>
    >
    try {
      authorized = await deps.authorizeReplyPublicationProviderCall({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        sourceEpoch: input.sourceEpoch,
        reviewId: input.reviewId,
        materialReviewRevision: input.materialReviewRevision,
        replyId: input.replyId,
        publicationCycle: input.publicationCycle,
        attemptNumber: input.attemptNumber,
      })
    } catch (refusal) {
      throw await withReauthorizationCause(input, replyAuthorizationRefusal(refusal))
    }
    assertReplyAuthorizationBinds(authorized.authorization, input)
    try {
      const result = await executeGoogleProviderRaw({
        operation: 'reviews.reply',
        descriptor: {
          routeKey: 'reviews.reply',
          accessToken: authorized.accessToken,
          reviewName: input.reviewName,
          comment: input.text,
        },
        authorization: authorized.authorization,
        executor: deps.executor,
        nowMs,
      })
      const providerCorrelationId = result.headers.providerCorrelationId ?? null
      result.body.fill(0)
      return { providerCorrelationId }
    } catch (error) {
      // The raw helper has already zeroed the body and dropped the headers,
      // so the correlation id is honestly unknown here.
      if (isAcceptedNonJsonWrite(error)) return { providerCorrelationId: null }
      throw await withReauthorizationCause(input, executorErrorToReviewApiError(error))
    }
  }

  const replyToReview: GoogleReviewApiPort['replyToReview'] = async (input) => {
    assertValidReplyPublicationInput(input)
    return replyViaExecutor(input)
  }

  return Object.freeze({
    listReviewsPage,
    getReview,
    discardReviewCursors,
    replyToReview,
  })
}
