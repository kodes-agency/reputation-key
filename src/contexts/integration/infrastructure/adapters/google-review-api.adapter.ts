import type {
  GoogleReviewApiError,
  GoogleReviewApiPort,
  GoogleReviewPageRequest,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewHeadRequest } from '#/contexts/review/application/ports/google-review-api.port'
import { REVIEW_LIST_NEWEST_UPDATED_FIRST } from '#/shared/google-provider-control/review-route-descriptors'
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
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { reportRefusedReviewPages } from './google-review-page'
import {
  gbpReviewItemSchema,
  isNewestUpdatedFirst,
  mapReview,
  parseReviewsPage,
} from './google-review-page-parse'
import { reportReplyModeration } from './google-review-reply-moderation'
import {
  executeGoogleProviderJson,
  executeGoogleProviderRaw,
  gatewayFailureError,
  providerStatusError,
} from './google-provider-adapter'
import {
  executorErrorToReviewApiError,
  invalidRequest,
  isAcceptedNonJsonWrite,
  isGoogleReviewApiError,
  replyAuthorizationRefusal,
  replyPreReadAuthorizationRefusal,
  reviewApiError,
} from './google-review-api-errors'
import {
  googleReviewCursorAuthorization,
  sameGoogleReviewCursorAuthorization,
  type GoogleReviewCursorAuthorization,
  type GoogleReviewCursorStore,
} from '../google-review-cursor-store'
import {
  callCursorStore,
  createPageCursorSpender,
  cursorRejectionError,
  cursorRejectionLogger,
} from './google-review-page-cursor'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/iu
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

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

const PAGE_REQUEST_KEYS = [
  'organizationId',
  'propertyId',
  'connectionId',
  'sourceEpoch',
  'locationName',
  'runId',
  'phase',
  'pageIndex',
  'cursorRef',
] as const

/** Request-shape validation for one list page; every failure is the same refusal. */
function assertValidPageRequest(input: GoogleReviewPageRequest): void {
  if (
    !exactKeys(input, PAGE_REQUEST_KEYS) ||
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
}

const HEAD_REQUEST_KEYS = [
  'organizationId',
  'propertyId',
  'connectionId',
  'sourceEpoch',
  'locationName',
] as const

/** Request-shape validation for the head read; every failure is the same refusal. */
function assertValidHeadRequest(input: GoogleReviewHeadRequest): void {
  if (
    !exactKeys(input, HEAD_REQUEST_KEYS) ||
    !isSafeScopeId(input.organizationId) ||
    !isCanonicalUuid(input.propertyId) ||
    !isCanonicalUuid(input.connectionId) ||
    !isCountAtLeast(input.sourceEpoch, 0)
  ) {
    throw invalidRequest()
  }
  assertLocationName(input.locationName)
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
  const logCursorRejection = cursorRejectionLogger(deps.logger)
  const underPageCursor = createPageCursorSpender({
    cursorStore: deps.cursorStore,
    logRejection: logCursorRejection,
  })

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
    resolve: typeof resolveProviderContext = resolveProviderContext,
  ): Promise<void> => {
    const current = await resolve(input)
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
    assertValidPageRequest(input)
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
    const use = input.cursorRef
      ? { cursorRef: input.cursorRef, scope, authorization: context.cursorAuthorization }
      : null
    const raw = await underPageCursor(use, cursorDiagnostic, (pageToken) =>
      requestJson(
        'reviews.list',
        {
          routeKey: 'reviews.list',
          accessToken: context.accessToken,
          locationName: input.locationName,
          ...(pageToken ? { pageToken } : {}),
        },
        context,
      ),
    )
    await assertAuthorizationCurrent(input, context.cursorAuthorization)
    const page = parseReviewsPage(raw, input.locationName, deps.logger)
    let nextCursorRef: string | null = null
    const nextPageToken = page.nextPageToken
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
        throw await cursorRejectionError(
          { cursorStore: deps.cursorStore, logRejection: logCursorRejection },
          published.code,
          {
            operation: 'publish_next',
            // `binding_mismatch` has three distinct causes inside the store: a
            // scope field diverging, a null parent ref anywhere but page 0, and
            // a next page index that is not scope + 1. The code alone cannot
            // tell them apart, so carry the two the adapter controls.
            parentCursorRefPresent: input.cursorRef !== null,
            nextPageIndex: input.pageIndex + 1,
            ...cursorDiagnostic,
          },
        )
      }
      nextCursorRef = published.value.nextCursorRef
    }
    return {
      reviews: page.reviews,
      totalReviewCount: page.totalReviewCount,
      averageRating: page.averageRating,
      nextCursorRef,
    }
  }

  /**
   * Page 1 of the list, newest-updated first, and nothing else: no run, no
   * cursor published or redeemed, no continuation. A page that is not really in
   * that order is reported, never returned.
   */
  const readReviewsHead: GoogleReviewApiPort['readReviewsHead'] = async (input) => {
    assertValidHeadRequest(input)
    const context = await resolveProviderContext(input)
    const raw = await requestJson(
      'reviews.head',
      {
        routeKey: 'reviews.list',
        accessToken: context.accessToken,
        locationName: input.locationName,
        orderBy: REVIEW_LIST_NEWEST_UPDATED_FIRST,
      },
      context,
    )
    await assertAuthorizationCurrent(input, context.cursorAuthorization)
    const page = parseReviewsPage(raw, input.locationName, deps.logger)
    if (!isNewestUpdatedFirst(page.reviews)) return { status: 'order_violation' }
    return {
      status: 'ok',
      reviews: page.reviews,
      totalReviewCount: page.totalReviewCount,
      averageRating: page.averageRating,
      hasMore: page.nextPageToken !== undefined,
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
    const forReplyPublication = 'forReplyPublication' in input
    if (
      !exactKeys(input, [
        'organizationId',
        'propertyId',
        'connectionId',
        'sourceEpoch',
        'locationName',
        'reviewName',
        ...(forReplyPublication ? ['forReplyPublication'] : []),
      ]) ||
      (forReplyPublication && input.forReplyPublication !== true) ||
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
    const resolve = forReplyPublication
      ? resolveReplyPreReadContext
      : resolveProviderContext
    const context = await resolve(input)
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
        await assertAuthorizationCurrent(input, context.cursorAuthorization, resolve)
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
    await assertAuthorizationCurrent(input, context.cursorAuthorization, resolve)
    const parsed = gbpReviewItemSchema.safeParse(raw)
    if (!parsed.success) throw reviewApiError('malformed_response', false)
    const review = mapReview(parsed.data, input.locationName)
    reportRefusedReviewPages(
      deps.logger,
      'reviews.get',
      [parsed.data],
      [review.googleReviewUrl],
    )
    reportReplyModeration(deps.logger, 'reviews.get', [parsed.data])
    return { status: 'found', review }
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
    input: Pick<GoogleReplyPublicationInput, 'organizationId' | 'connectionId'>,
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

  /**
   * `resolveProviderContext` for the read before a reply is published: its
   * refusals leave in the write path's vocabulary (see
   * `GoogleReviewGetRequest.forReplyPublication`).
   */
  const resolveReplyPreReadContext: typeof resolveProviderContext = async (input) => {
    try {
      return await resolveProviderContext(input)
    } catch (error) {
      throw await withReauthorizationCause(
        input,
        isGoogleReviewApiError(error)
          ? (error as GoogleReviewApiError)
          : replyPreReadAuthorizationRefusal(error),
      )
    }
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
    readReviewsHead,
    getReview,
    discardReviewCursors,
    replyToReview,
  })
}
