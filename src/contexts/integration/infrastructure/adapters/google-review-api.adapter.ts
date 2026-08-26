import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import type {
  GoogleReview,
  GoogleReviewApiErrorCode,
  GoogleReviewApiPort,
  StarRating,
} from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import type { RefreshGoogleToken } from '../../application/use-cases/refresh-google-token'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import { canonicalProviderAuthorizationVector } from '#/shared/provider-ephemeral/authorization-binding'
import {
  parseReviewProviderResource,
  type ReviewProviderResource,
} from '#/shared/review-provider-subject-contract'
import { parseGoogleReviewComment } from '#/shared/google-review-comment'
import {
  executeGoogleProviderJson,
  executeGoogleProviderRaw,
} from './google-provider-adapter'
import type {
  GoogleReviewCursorAuthorization,
  GoogleReviewCursorFailureCode,
  GoogleReviewCursorStore,
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

const gbpReviewsPageSchema = z.object({
  reviews: z.array(gbpReviewItemSchema).max(PAGE_SIZE).optional(),
  totalReviewCount: z.number().int().safe().nonnegative(),
  nextPageToken: z.string().min(1).max(2_048).optional(),
})

type GbpReviewItem = z.infer<typeof gbpReviewItemSchema>

type GoogleReviewApiAdapterDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  encryption: TokenEncryptionPort
  refreshToken: RefreshGoogleToken
  logger: LoggerPort
  baseUrl: string
  cursorStore: GoogleReviewCursorStore
  executor?: GoogleAuthorizedProviderExecutor
  authorizeProviderCall?: (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
  ) => Promise<
    Readonly<{
      accessToken: string
      authorization: GoogleProviderCallAuthorization
    }>
  >
  /**
   * Production fail-closed check for the DIRECT `fetch` fallback below. The
   * fallback is reachable merely by leaving the six GOOGLE_EGRESS_* values
   * unset, and it bypasses admission, quota control, credential binding and
   * mTLS. The composition root wires
   * the production no-direct-egress guard here; absent (simulations, tests,
   * bare adapter construction) retains the deterministic local path only.
   */
  assertDirectEgressAllowed?: (operation: string) => void
  nowMs?: () => number
}>

type ProviderContext = Readonly<{
  accessToken: string
  authorization: GoogleProviderCallAuthorization | null
  cursorAuthorization: GoogleReviewCursorAuthorization
}>

function defineEnumerable<T>(value: T): PropertyDescriptor {
  return {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  }
}

/**
 * `retryAfterMs` carries the provider's own backoff hint to the scheduler.
 *
 * Dropping it was a live amplification bug: a `quota_exhausted` admission
 * denial surfaces as `provider_rate_limited`, the snapshot use case checkpoints
 * WITHOUT advancing its cursor, and the sync job re-enqueued the continuation
 * with no delay - so a provider asking for a ~1s pause got hammered at queue
 * speed instead (observed: 3,225 denials over 344s, ~9/s, which starved every
 * other Google route sharing the quota, reply publishing included).
 */
function reviewApiError(
  code: GoogleReviewApiErrorCode,
  recoverable: boolean,
  retryAfterMs?: number,
): Error & {
  readonly _tag: 'GoogleReviewApiError'
  readonly code: GoogleReviewApiErrorCode
  readonly recoverable: boolean
  readonly retryAfterMs?: number
} {
  const error = new Error('Google review API request failed') as Error & {
    readonly _tag: 'GoogleReviewApiError'
    readonly code: GoogleReviewApiErrorCode
    readonly recoverable: boolean
    readonly retryAfterMs?: number
  }
  Object.defineProperties(error, {
    name: defineEnumerable('GoogleReviewApiError'),
    _tag: defineEnumerable('GoogleReviewApiError'),
    code: defineEnumerable(code),
    recoverable: defineEnumerable(recoverable),
    ...(retryAfterMs === undefined
      ? {}
      : { retryAfterMs: defineEnumerable(retryAfterMs) }),
  })
  return error
}

/**
 * Maps an authorized-executor rejection onto the review API's error vocabulary,
 * preserving the backoff hint the executor already computed
 * (`googleRetryFloorMs` over Retry-After or the admission denial). Dropping it
 * turned a rate-limited provider into a queue-speed retry loop.
 */
function executorErrorToReviewApiError(error: unknown): Error {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('kind' in error) ||
    error.kind !== 'rate_limited'
  ) {
    return reviewApiError('provider_unavailable', true)
  }
  const hint =
    'retryAfterMs' in error && typeof error.retryAfterMs === 'number'
      ? error.retryAfterMs
      : undefined
  return reviewApiError('provider_rate_limited', true, hint)
}

function isGoogleReviewApiError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    error._tag === 'GoogleReviewApiError'
  )
}

function cursorFailureCode(
  code: GoogleReviewCursorFailureCode,
): GoogleReviewApiErrorCode {
  const mapping: Readonly<
    Record<GoogleReviewCursorFailureCode, GoogleReviewApiErrorCode>
  > = {
    not_found: 'cursor_not_found',
    expired: 'cursor_expired',
    binding_mismatch: 'cursor_binding_mismatch',
    exhausted: 'cursor_exhausted',
    capacity_exceeded: 'cursor_capacity_exceeded',
    conflict: 'provider_unavailable',
    unavailable: 'provider_unavailable',
  }
  return mapping[code]
}

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

function assertLocationName(locationName: string): void {
  try {
    parseReviewProviderResource(`${locationName}/reviews/validation`)
  } catch {
    throw reviewApiError('invalid_request', false)
  }
}

function assertReviewName(reviewName: string, locationName: string): void {
  try {
    parseReviewProviderResource(reviewName)
  } catch {
    throw reviewApiError('invalid_request', false)
  }
  if (!reviewName.startsWith(`${locationName}/reviews/`)) {
    throw reviewApiError('invalid_request', false)
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw reviewApiError('malformed_response', false)
  return parsed
}

function mapReview(raw: GbpReviewItem, locationName: string): GoogleReview {
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
    replyText: raw.reviewReply?.comment ?? null,
    replyUpdatedAt: raw.reviewReply?.updateTime
      ? parseDate(raw.reviewReply.updateTime)
      : null,
  }
}

function authorizationDigest(
  authorization: GoogleProviderCallAuthorization | null,
): string {
  const canonical = authorization
    ? JSON.stringify({
        capability: authorization.capability,
        organizationId: authorization.organizationId,
        propertyId: authorization.propertyId,
        connectionId: authorization.connectionId,
        initiatorUserId: authorization.initiatorUserId,
        approvalBindingId: authorization.approvalBindingId,
        expectedCredentialGeneration: authorization.expectedCredentialGeneration,
        authorizationVector: canonicalProviderAuthorizationVector(
          authorization.authorizationVector,
        ),
      })
    : '{}'
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function sameCursorAuthorization(
  left: GoogleReviewCursorAuthorization,
  right: GoogleReviewCursorAuthorization,
): boolean {
  return (
    left.connectionLifecycleVersion === right.connectionLifecycleVersion &&
    left.connectionAccessVersion === right.connectionAccessVersion &&
    left.credentialGeneration === right.credentialGeneration &&
    left.approvalBindingId === right.approvalBindingId &&
    left.authorizationVectorSha256 === right.authorizationVectorSha256
  )
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

async function readBoundedResponseBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel()
    throw reviewApiError('malformed_response', false)
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw reviewApiError('malformed_response', false)
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    if (isGoogleReviewApiError(error)) throw error
    throw reviewApiError('provider_unavailable', true)
  } finally {
    reader.releaseLock()
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
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
  ): Promise<ProviderContext> => {
    let accessToken: string
    let authorization: GoogleProviderCallAuthorization | null
    let connection
    if (deps.executor) {
      if (!deps.authorizeProviderCall) {
        throw reviewApiError('provider_unavailable', true)
      }
      const authorized = await deps.authorizeProviderCall(organizationId, connectionId)
      accessToken = authorized.accessToken
      authorization = authorized.authorization
      connection = await deps.connectionRepo.findById(organizationId, connectionId)
    } else {
      connection = await deps.refreshToken(organizationId, connectionId)
      accessToken = deps.encryption.decrypt(connection.encryptedAccessToken)
      authorization = null
    }
    if (
      !connection ||
      connection.status !== 'active' ||
      connection.credentialUseState !== 'active' ||
      (authorization !== null &&
        (authorization.organizationId !== organizationId ||
          authorization.connectionId !== connectionId ||
          authorization.expectedCredentialGeneration !== connection.credentialGeneration))
    ) {
      throw reviewApiError('authorization_changed', false)
    }
    return {
      accessToken,
      authorization,
      cursorAuthorization: {
        connectionLifecycleVersion: connection.lifecycleVersion,
        connectionAccessVersion: connection.accessVersion,
        credentialGeneration: connection.credentialGeneration,
        approvalBindingId: authorization?.approvalBindingId ?? null,
        authorizationVectorSha256: authorizationDigest(authorization),
      },
    }
  }

  const assertAuthorizationCurrent = async (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
    expected: GoogleReviewCursorAuthorization,
  ): Promise<void> => {
    const current = await resolveProviderContext(organizationId, connectionId)
    if (!sameCursorAuthorization(current.cursorAuthorization, expected)) {
      throw reviewApiError('authorization_changed', false)
    }
  }

  const requestJson = async (
    operation: string,
    descriptor: GoogleProviderRouteDescriptor,
    context: ProviderContext,
    directUrl: string,
  ): Promise<unknown> => {
    if (deps.executor && context.authorization) {
      try {
        return await trace(`googleReviewApi.${operation}`, () =>
          executeGoogleProviderJson({
            operation,
            descriptor,
            authorization: context.authorization!,
            executor: deps.executor!,
            nowMs,
          }),
        )
      } catch (error) {
        throw executorErrorToReviewApiError(error)
      }
    }
    deps.assertDirectEgressAllowed?.(operation)
    const timeout = withTimeout(30_000)
    let response: Response
    try {
      response = await trace(`googleReviewApi.${operation}`, () =>
        fetch(directUrl, {
          headers: { Authorization: `Bearer ${context.accessToken}` },
          signal: timeout.signal,
        }),
      )
    } catch {
      throw reviewApiError('provider_unavailable', true)
    } finally {
      timeout.clear()
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw reviewApiError(
        response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
        response.status === 429 || response.status >= 500,
      )
    }
    const contentType = response.headers.get('content-type')
    if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel()
      throw reviewApiError('malformed_response', false)
    }
    return parseJsonBytes(await readBoundedResponseBody(response))
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
      throw reviewApiError('invalid_request', false)
    }
    assertLocationName(input.locationName)
    const context = await resolveProviderContext(input.organizationId, input.connectionId)
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
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
    if (pageToken) params.set('pageToken', pageToken)
    const raw = await requestJson(
      'reviews.list',
      {
        routeKey: 'reviews.list',
        accessToken: context.accessToken,
        locationName: input.locationName,
        ...(pageToken ? { pageToken } : {}),
      },
      context,
      `${deps.baseUrl}/${input.locationName}/reviews?${params.toString()}`,
    )
    await assertAuthorizationCurrent(
      input.organizationId,
      input.connectionId,
      context.cursorAuthorization,
    )
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
      nextCursorRef,
    }
  }

  // Accepted residual: a provider-boundary reader that must not trust anything
  // it is handed. The code paths are an exact-key check, six identifier/range
  // validations, transport selection, and per-status provider error mapping —
  // each one a distinct way Google or a caller can be wrong, and every one has
  // to stay ahead of the parse. Already over both thresholds on main; this
  // branch added a single line, the `assertDirectEgressAllowed?.('reviews.get')`
  // fail-closed guard for the direct-fetch fallback. Collapsing the validation
  // ladder into a helper would hide exactly which input was rejected, which is
  // the one thing this function exists to report.
  // Revisit if the validation ladder is ever shared with listReviewsPage and
  // reviews.reply — three copies would justify a validated-input type that all
  // three parse into once, and would drop all three functions at the same time.
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
      throw reviewApiError('invalid_request', false)
    }
    assertLocationName(input.locationName)
    assertReviewName(input.reviewName, input.locationName)
    const context = await resolveProviderContext(input.organizationId, input.connectionId)
    let raw: unknown
    if (deps.executor && context.authorization) {
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
        if (!result.ok) {
          throw reviewApiError('provider_unavailable', true)
        }
        if (result.status === 404) {
          result.body.fill(0)
          await assertAuthorizationCurrent(
            input.organizationId,
            input.connectionId,
            context.cursorAuthorization,
          )
          return { status: 'not_found' }
        }
        if (
          result.status !== 200 ||
          !result.headers.contentType ||
          !JSON_CONTENT_TYPE.test(result.headers.contentType)
        ) {
          result.body.fill(0)
          throw reviewApiError(
            result.status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
            result.status === 429 || result.status >= 500,
          )
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
    } else {
      deps.assertDirectEgressAllowed?.('reviews.get')
      const timeout = withTimeout(30_000)
      let response: Response
      try {
        response = await fetch(`${deps.baseUrl}/${input.reviewName}`, {
          headers: { Authorization: `Bearer ${context.accessToken}` },
          signal: timeout.signal,
        })
      } catch {
        throw reviewApiError('provider_unavailable', true)
      } finally {
        timeout.clear()
      }
      if (response.status === 404) {
        await response.body?.cancel()
        await assertAuthorizationCurrent(
          input.organizationId,
          input.connectionId,
          context.cursorAuthorization,
        )
        return { status: 'not_found' }
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw reviewApiError(
          response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
          response.status === 429 || response.status >= 500,
        )
      }
      const contentType = response.headers.get('content-type')
      if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
        await response.body?.cancel()
        throw reviewApiError('malformed_response', false)
      }
      raw = parseJsonBytes(await readBoundedResponseBody(response))
    }
    await assertAuthorizationCurrent(
      input.organizationId,
      input.connectionId,
      context.cursorAuthorization,
    )
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
      throw reviewApiError('invalid_request', false)
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

  const replyToReview: GoogleReviewApiPort['replyToReview'] = async (
    organizationId,
    connectionId,
    reviewName,
    text,
  ) => {
    const context = await resolveProviderContext(organizationId, connectionId)
    if (deps.executor && context.authorization) {
      const response = await trace('googleReviewApi.replyToReview', () =>
        executeGoogleProviderRaw({
          operation: 'review reply',
          descriptor: {
            routeKey: 'reviews.reply',
            accessToken: context.accessToken,
            reviewName,
            comment: text,
          },
          authorization: context.authorization!,
          executor: deps.executor!,
          nowMs,
        }),
      )
      response.body.fill(0)
      return
    }
    deps.assertDirectEgressAllowed?.('reviews.reply')
    const timeout = withTimeout(30_000)
    let response: Response
    try {
      response = await fetch(`${deps.baseUrl}/${reviewName}/reply`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: text }),
        signal: timeout.signal,
      })
    } finally {
      timeout.clear()
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw reviewApiError(
        response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
        response.status === 429 || response.status >= 500,
      )
    }
  }

  return Object.freeze({
    listReviewsPage,
    getReview,
    discardReviewCursors,
    replyToReview,
  })
}
