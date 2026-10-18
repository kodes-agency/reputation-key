import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod/v4'
import {
  canonicalProviderAuthorizationVector,
  providerAuthorizationVectorWithoutCredentialGeneration,
} from '#/shared/provider-ephemeral/authorization-binding'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleProviderCallAuthorization } from '../application/google-provider-contract'
import type { GoogleConnection } from '../domain/types'

const NAMESPACE = 'opaque-reference' as const
const CURSOR_TTL_SECONDS = 30 * 60
/**
 * How many times one page token may be SENT to Google: the replay bound. A
 * `redeem` takes one before the request goes out, and `release` gives it back
 * only when the provider plane proves the request never left (dispatch
 * `not_sent`: a quota or permit refusal, a deadline that elapsed before
 * `fetch`). So a quota wait of any length spends nothing. On the closed beta
 * (2026-10-16..18) every `quota_exhausted` refusal spent one, and the sixth
 * retry of a page failed its run as `cursor_failure` (126 runs).
 *
 * A request that reached Google, or may have (`answered`, including Google's
 * own 429 and 5xx, or `unknown` after a transport failure), keeps its use:
 * Google saw the token, and that is what the bound counts. Ten is one fetch
 * plus nine dispatched retries of the same page. Each retry waits at least the
 * provider plane's 5 s floor and honours Retry-After up to 300 s, so nine in a
 * row inside the cursor's 30-minute life is a sustained fault rather than a
 * burst, and the run fails and starts afresh. Raised from 5 on 2026-10-18.
 */
const MAX_CURSOR_REDEMPTIONS = 10
/** A release lost to a racing redeem re-reads the record and tries again. */
const MAX_RELEASE_ATTEMPTS = 3
const MAX_RUN_RECORDS = 1_024
const MAX_RUN_BYTES = 4 * 1024 * 1024
const MAX_ORGANIZATION_RECORDS = 10_000
const MAX_ORGANIZATION_BYTES = 40 * 1024 * 1024
const MAX_PUBLICATION_ATTEMPTS = 3
const MAX_CLOCK_SKEW_MS = 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u
const KEY_VERSION = /^[a-z][a-z0-9_-]{0,31}$/u
const HANDLE_DIGEST = /^[A-Za-z0-9_-]{43}$/u
const HANDLE = /^([a-z][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{43})$/u
const RESOURCE = /^[\x21-\x7e]{1,1024}$/u
const PROVIDER_TOKEN_BYTES = 2_048

export type GoogleReviewCursorScope = Readonly<{
  organizationId: string
  propertyId: string
  connectionId: string
  sourceEpoch: number
  locationName: string
  runId: string
  phase: 'main' | 'confirmation'
  pageIndex: number
}>

/**
 * What a cursor is bound to. The credential generation is deliberately absent:
 * a routine access-token refresh moves only it, about once an hour, and a scan
 * that crosses one must keep its cursor. Reconnect, disconnect and revocation
 * move the two versions, which stay bound.
 */
export type GoogleReviewCursorAuthorization = Readonly<{
  connectionLifecycleVersion: number
  connectionAccessVersion: number
  authorizationVectorSha256: string
}>

/**
 * The binding a review cursor is published and redeemed under. Its digest leaves
 * out the credential generation, both as the authorization's expectation and as
 * the vector member (see the type above); every other fact stays exact.
 */
export function googleReviewCursorAuthorization(
  connection: Pick<GoogleConnection, 'lifecycleVersion' | 'accessVersion'>,
  authorization: GoogleProviderCallAuthorization,
): GoogleReviewCursorAuthorization {
  const canonical = JSON.stringify({
    capability: authorization.capability,
    organizationId: authorization.organizationId,
    propertyId: authorization.propertyId,
    connectionId: authorization.connectionId,
    initiatorUserId: authorization.initiatorUserId,
    authorizationVector: canonicalProviderAuthorizationVector(
      providerAuthorizationVectorWithoutCredentialGeneration(
        authorization.authorizationVector,
      ),
    ),
  })
  return {
    connectionLifecycleVersion: connection.lifecycleVersion,
    connectionAccessVersion: connection.accessVersion,
    authorizationVectorSha256: createHash('sha256')
      .update(canonical, 'utf8')
      .digest('hex'),
  }
}

export function sameGoogleReviewCursorAuthorization(
  left: GoogleReviewCursorAuthorization,
  right: GoogleReviewCursorAuthorization,
): boolean {
  return (
    left.connectionLifecycleVersion === right.connectionLifecycleVersion &&
    left.connectionAccessVersion === right.connectionAccessVersion &&
    left.authorizationVectorSha256 === right.authorizationVectorSha256
  )
}

export type GoogleReviewCursorFailureCode =
  | 'not_found'
  | 'expired'
  | 'binding_mismatch'
  | 'exhausted'
  | 'capacity_exceeded'
  | 'conflict'
  | 'unavailable'

export type GoogleReviewCursorResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: GoogleReviewCursorFailureCode }>

/** One use of a cursor: the handle and the binding it must be used under. */
export type GoogleReviewCursorUse = Readonly<{
  cursorRef: string
  scope: GoogleReviewCursorScope
  authorization: GoogleReviewCursorAuthorization
}>

export type GoogleReviewCursorStore = Readonly<{
  /** Takes one redemption (see MAX_CURSOR_REDEMPTIONS) and returns the token. */
  redeem(
    input: GoogleReviewCursorUse,
  ): Promise<GoogleReviewCursorResult<Readonly<{ pageToken: string }>>>
  /**
   * Gives back the redemption `redeem` took for a request the provider plane
   * refused before it reached Google (dispatch `not_sent`), and nothing else.
   * It is bound exactly as `redeem` is, compare-and-swap safe against a
   * racing redeem, and never lifts the budget above MAX_CURSOR_REDEMPTIONS, so
   * a release with no redemption behind it is refused as `conflict`.
   */
  release(input: GoogleReviewCursorUse): Promise<GoogleReviewCursorResult<null>>
  publishNext(
    input: Readonly<{
      parentCursorRef: string | null
      scope: GoogleReviewCursorScope
      nextScope: GoogleReviewCursorScope
      authorization: GoogleReviewCursorAuthorization
      nextPageToken: string
    }>,
  ): Promise<GoogleReviewCursorResult<Readonly<{ nextCursorRef: string }>>>
  discardRun(
    input: Readonly<{
      organizationId: string
      propertyId: string
      sourceEpoch: number
      runId: string
    }>,
  ): Promise<boolean>
  /**
   * When the backing store started, or null when it cannot tell. It keeps
   * nothing across a restart (ADR 0050), so a cursor `not_found` after that
   * instant may have been lost to the restart; before it, it was not.
   */
  startedAtMs(): Promise<number | null>
}>

const authorizationSchema = z
  .object({
    connectionLifecycleVersion: z.number().int().safe().nonnegative(),
    connectionAccessVersion: z.number().int().safe().nonnegative(),
    authorizationVectorSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()

const scopeSchema = z
  .object({
    organizationId: z.string().regex(SAFE_SCOPE_ID),
    propertyId: z.string().regex(UUID),
    connectionId: z.string().regex(UUID),
    sourceEpoch: z.number().int().safe().nonnegative(),
    locationName: z.string().regex(RESOURCE),
    runId: z.string().regex(UUID),
    phase: z.enum(['main', 'confirmation']),
    pageIndex: z.number().int().min(0).max(199),
  })
  .strict()

const childSchema = z
  .object({
    cursorRef: z.string().regex(HANDLE),
    nextTokenHmacKeyVersion: z.string().regex(KEY_VERSION),
    nextTokenHmac: z.string().regex(HANDLE_DIGEST),
  })
  .strict()
  .nullable()

const cursorRecordSchema = z
  .object({
    schemaVersion: z.literal(2),
    audience: z.literal('review_sync_cursor'),
    keyVersion: z.string().regex(KEY_VERSION),
    handleNonce: z.string().regex(HANDLE_DIGEST),
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().positive(),
    scope: scopeSchema,
    authorization: authorizationSchema,
    pageToken: z.string().min(1).max(PROVIDER_TOKEN_BYTES),
    remainingRedemptions: z.number().int().min(0).max(MAX_CURSOR_REDEMPTIONS),
    child: childSchema,
  })
  .strict()

type CursorRecord = z.infer<typeof cursorRecordSchema>

const pageLinkSchema = z
  .object({
    schemaVersion: z.literal(2),
    audience: z.literal('review_sync_cursor_page_link'),
    scope: scopeSchema,
    authorization: authorizationSchema,
    nextTokenHmacKeyVersion: z.string().regex(KEY_VERSION),
    nextTokenHmac: z.string().regex(HANDLE_DIGEST),
    nextCursorRef: z.string().regex(HANDLE),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()

type PageLink = z.infer<typeof pageLinkSchema>

const indexEntrySchema = z
  .object({
    key: z.string().regex(HANDLE_DIGEST),
    bytes: z.number().int().safe().positive(),
  })
  .strict()
const indexSchema = z
  .object({
    schemaVersion: z.literal(1),
    audience: z.enum(['review_sync_cursor_run_index', 'review_sync_cursor_org_index']),
    invalidated: z.boolean(),
    entries: z.array(indexEntrySchema).max(MAX_ORGANIZATION_RECORDS),
  })
  .strict()

type CursorIndex = z.infer<typeof indexSchema>

function parseJson<T>(encoded: string, schema: z.ZodType<T>): T | null {
  try {
    return schema.safeParse(JSON.parse(encoded)).data ?? null
  } catch {
    return null
  }
}

function sameObject(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isExpired(record: CursorRecord, atMs: number): boolean {
  return record.expiresAtMs <= atMs || record.issuedAtMs > atMs + MAX_CLOCK_SKEW_MS
}

function isBoundTo(record: CursorRecord, use: GoogleReviewCursorUse): boolean {
  return (
    sameObject(record.scope, use.scope) &&
    sameObject(record.authorization, use.authorization)
  )
}

function assertScope(scope: GoogleReviewCursorScope): void {
  if (!scopeSchema.safeParse(scope).success)
    throw new Error('review cursor scope is malformed')
}

function assertAuthorization(authorization: GoogleReviewCursorAuthorization): void {
  if (!authorizationSchema.safeParse(authorization).success) {
    throw new Error('review cursor authorization is malformed')
  }
}

function keyFor(keys: VersionedHmacKeyring, audience: string, value: unknown): string {
  return keys.sign(audience, JSON.stringify(value)).digest
}

function keyForVersion(
  keys: VersionedHmacKeyring,
  audience: string,
  value: unknown,
  keyVersion: string,
): string | null {
  return keys.derive(audience, JSON.stringify(value), keyVersion)
}

function cursorKey(cursorRef: string): string | null {
  return HANDLE.exec(cursorRef)?.[2] ?? null
}

function cursorVersion(cursorRef: string): string | null {
  return HANDLE.exec(cursorRef)?.[1] ?? null
}

function totalBytes(entries: readonly Readonly<{ bytes: number }>[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0)
}

function appendEntries(
  index: CursorIndex,
  additions: readonly Readonly<{ key: string; bytes: number }>[],
  maxRecords: number,
  maxBytes: number,
): CursorIndex | null {
  if (index.invalidated) return null
  const byKey = new Map(index.entries.map((entry) => [entry.key, entry]))
  for (const addition of additions) {
    const existing = byKey.get(addition.key)
    if (existing && existing.bytes !== addition.bytes) return null
    byKey.set(addition.key, addition)
  }
  const entries = [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  )
  if (entries.length > maxRecords || totalBytes(entries) > maxBytes) return null
  return { ...index, entries }
}

function emptyIndex(audience: CursorIndex['audience']): CursorIndex {
  return { schemaVersion: 1, audience, invalidated: false, entries: [] }
}

function encode(value: unknown): string {
  return JSON.stringify(value)
}

function ttlSeconds(expiresAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1_000))
}

export const createGoogleReviewCursorStore = (
  deps: Readonly<{
    store: ProviderEphemeralStore
    keys: VersionedHmacKeyring
    nowMs?: () => number
    randomNonce?: () => string
  }>,
): GoogleReviewCursorStore => {
  const nowMs = deps.nowMs ?? Date.now
  const randomNonce = deps.randomNonce ?? (() => randomBytes(32).toString('base64url'))

  const runIndexKey = (
    scope: Pick<
      GoogleReviewCursorScope,
      'organizationId' | 'propertyId' | 'sourceEpoch' | 'runId'
    >,
  ) =>
    keyFor(deps.keys, 'review-sync-run-index-v1', {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      sourceEpoch: scope.sourceEpoch,
      runId: scope.runId,
    })
  const organizationIndexKey = (organizationId: string) =>
    keyFor(deps.keys, 'review-sync-org-index-v1', organizationId)
  const pageLinkKey = (scope: GoogleReviewCursorScope) =>
    keyFor(deps.keys, 'review-sync-page-link-v1', scope)
  const keyVersions = Object.freeze([
    deps.keys.activeVersion,
    ...deps.keys.retainedVersions,
  ])
  const derivedKeys = (audience: string, value: unknown) =>
    keyVersions.flatMap((keyVersion) => {
      const key = keyForVersion(deps.keys, audience, value, keyVersion)
      return key ? [key] : []
    })

  const loadIndex = async (key: string, audience: CursorIndex['audience']) => {
    const encoded = await deps.store.read(NAMESPACE, key)
    if (!encoded) return { encoded: null, value: emptyIndex(audience) }
    const parsed = parseJson(encoded, indexSchema)
    if (!parsed || parsed.audience !== audience) return null
    return { encoded, value: parsed }
  }

  const loadCursor = async (cursorRef: string) => {
    const key = cursorKey(cursorRef)
    const version = cursorVersion(cursorRef)
    if (
      !key ||
      !version ||
      deps.keys.derive('review-sync-cursor-handle-v1', 'probe', version) == null
    ) {
      return null
    }
    const encoded = await deps.store.read(NAMESPACE, key)
    if (!encoded) return null
    const record = parseJson(encoded, cursorRecordSchema)
    if (
      !record ||
      record.keyVersion !== version ||
      !deps.keys.verify(
        'review-sync-cursor-handle-v1',
        record.handleNonce,
        record.keyVersion,
        key,
      )
    ) {
      return null
    }
    return { key, encoded, record }
  }

  /** Compare-and-swap of one cursor's budget; the rest of the record is kept. */
  const replaceRemaining = (
    loaded: Readonly<{ key: string; encoded: string; record: CursorRecord }>,
    remainingRedemptions: number,
    atMs: number,
  ) =>
    deps.store.replaceIfEquals(
      NAMESPACE,
      loaded.key,
      loaded.encoded,
      encode({ ...loaded.record, remainingRedemptions } satisfies CursorRecord),
      ttlSeconds(loaded.record.expiresAtMs, atMs),
    )

  return Object.freeze({
    redeem: async (input) => {
      assertScope(input.scope)
      assertAuthorization(input.authorization)
      const loaded = await loadCursor(input.cursorRef)
      if (!loaded) return { ok: false, code: 'not_found' }
      const atMs = nowMs()
      if (isExpired(loaded.record, atMs)) {
        await deps.store.consumeIfEquals(NAMESPACE, loaded.key, loaded.encoded)
        return { ok: false, code: 'expired' }
      }
      if (!isBoundTo(loaded.record, input)) {
        return { ok: false, code: 'binding_mismatch' }
      }
      if (loaded.record.remainingRedemptions === 0)
        return { ok: false, code: 'exhausted' }
      const replaced = await replaceRemaining(
        loaded,
        loaded.record.remainingRedemptions - 1,
        atMs,
      )
      if (replaced !== 'replaced') return { ok: false, code: 'conflict' }
      return { ok: true, value: { pageToken: loaded.record.pageToken } }
    },

    // Exactly the inverse of one redeem. The read-check-write runs again when a
    // racing redeem moved the record first, so that worker's use stays spent.
    release: async (input) => {
      assertScope(input.scope)
      assertAuthorization(input.authorization)
      for (let attempt = 0; attempt < MAX_RELEASE_ATTEMPTS; attempt += 1) {
        const loaded = await loadCursor(input.cursorRef)
        if (!loaded) return { ok: false, code: 'not_found' }
        const atMs = nowMs()
        if (isExpired(loaded.record, atMs)) return { ok: false, code: 'expired' }
        if (!isBoundTo(loaded.record, input)) {
          return { ok: false, code: 'binding_mismatch' }
        }
        if (loaded.record.remainingRedemptions >= MAX_CURSOR_REDEMPTIONS) {
          return { ok: false, code: 'conflict' }
        }
        const replaced = await replaceRemaining(
          loaded,
          loaded.record.remainingRedemptions + 1,
          atMs,
        )
        if (replaced === 'replaced') return { ok: true, value: null }
        if (replaced === 'not_found') return { ok: false, code: 'not_found' }
      }
      return { ok: false, code: 'conflict' }
    },

    publishNext: async (input) => {
      assertScope(input.scope)
      assertScope(input.nextScope)
      assertAuthorization(input.authorization)
      if (
        input.nextScope.organizationId !== input.scope.organizationId ||
        input.nextScope.propertyId !== input.scope.propertyId ||
        input.nextScope.connectionId !== input.scope.connectionId ||
        input.nextScope.sourceEpoch !== input.scope.sourceEpoch ||
        input.nextScope.locationName !== input.scope.locationName ||
        input.nextScope.runId !== input.scope.runId ||
        input.nextScope.phase !== input.scope.phase ||
        input.nextScope.pageIndex !== input.scope.pageIndex + 1
      ) {
        return { ok: false, code: 'binding_mismatch' }
      }
      if (input.parentCursorRef === null && input.scope.pageIndex !== 0) {
        return { ok: false, code: 'binding_mismatch' }
      }
      if (
        typeof input.nextPageToken !== 'string' ||
        input.nextPageToken.length < 1 ||
        Buffer.byteLength(input.nextPageToken, 'utf8') > PROVIDER_TOKEN_BYTES
      ) {
        return { ok: false, code: 'conflict' }
      }
      const atMs = nowMs()
      const expiresAtMs = atMs + CURSOR_TTL_SECONDS * 1_000
      const linkKeys = derivedKeys('review-sync-page-link-v1', input.scope)
      const loadedLinks = await Promise.all(
        linkKeys.map(async (key) => ({
          key,
          encoded: await deps.store.read(NAMESPACE, key),
        })),
      )
      const existingLinks = loadedLinks.filter(
        (candidate): candidate is Readonly<{ key: string; encoded: string }> =>
          candidate.encoded !== undefined,
      )
      if (existingLinks.length > 1) return { ok: false, code: 'conflict' }
      const existingLink = existingLinks[0]
      if (existingLink) {
        const link = parseJson(existingLink.encoded, pageLinkSchema)
        const child = link ? await loadCursor(link.nextCursorRef) : null
        if (
          !link ||
          link.expiresAtMs <= atMs ||
          !sameObject(link.scope, input.scope) ||
          !sameObject(link.authorization, input.authorization) ||
          !deps.keys.verify(
            'review-sync-next-token-v1',
            input.nextPageToken,
            link.nextTokenHmacKeyVersion,
            link.nextTokenHmac,
          ) ||
          !child ||
          !sameObject(child.record.scope, input.nextScope) ||
          !sameObject(child.record.authorization, input.authorization)
        ) {
          return { ok: false, code: 'conflict' }
        }
        return { ok: true, value: { nextCursorRef: link.nextCursorRef } }
      }
      const linkKey = pageLinkKey(input.scope)

      for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
        const runKey = runIndexKey(input.scope)
        const orgKey = organizationIndexKey(input.scope.organizationId)
        const runKeys = derivedKeys('review-sync-run-index-v1', {
          organizationId: input.scope.organizationId,
          propertyId: input.scope.propertyId,
          sourceEpoch: input.scope.sourceEpoch,
          runId: input.scope.runId,
        })
        const orgKeys = derivedKeys(
          'review-sync-org-index-v1',
          input.scope.organizationId,
        )
        const [runCandidates, orgCandidates, parent] = await Promise.all([
          Promise.all(
            runKeys.map(async (key) => ({
              key,
              loaded: await loadIndex(key, 'review_sync_cursor_run_index'),
            })),
          ),
          Promise.all(
            orgKeys.map(async (key) => ({
              key,
              loaded: await loadIndex(key, 'review_sync_cursor_org_index'),
            })),
          ),
          input.parentCursorRef
            ? loadCursor(input.parentCursorRef)
            : Promise.resolve(null),
        ])
        if (
          runCandidates.some((candidate) => candidate.loaded === null) ||
          orgCandidates.some((candidate) => candidate.loaded === null)
        ) {
          return { ok: false, code: 'unavailable' }
        }
        const runIndex = runCandidates.find(
          (candidate) => candidate.key === runKey,
        )?.loaded
        const orgIndex = orgCandidates.find(
          (candidate) => candidate.key === orgKey,
        )?.loaded
        if (!runIndex || !orgIndex) return { ok: false, code: 'unavailable' }
        const otherRunEntries = runCandidates.flatMap((candidate) =>
          candidate.key === runKey ? [] : (candidate.loaded?.value.entries ?? []),
        )
        const otherOrgEntries = orgCandidates.flatMap((candidate) =>
          candidate.key === orgKey ? [] : (candidate.loaded?.value.entries ?? []),
        )
        if (runCandidates.some((candidate) => candidate.loaded?.value.invalidated)) {
          return { ok: false, code: 'binding_mismatch' }
        }
        if (input.parentCursorRef) {
          // Gone, not mismatched: a store restart between the redeem of this
          // page and this publication drops the parent with everything else.
          if (!parent) return { ok: false, code: 'not_found' }
          if (
            !sameObject(parent.record.scope, input.scope) ||
            !sameObject(parent.record.authorization, input.authorization)
          ) {
            return { ok: false, code: 'binding_mismatch' }
          }
          if (parent.record.child) {
            if (
              deps.keys.verify(
                'review-sync-next-token-v1',
                input.nextPageToken,
                parent.record.child.nextTokenHmacKeyVersion,
                parent.record.child.nextTokenHmac,
              )
            ) {
              return {
                ok: true,
                value: { nextCursorRef: parent.record.child.cursorRef },
              }
            }
            return { ok: false, code: 'conflict' }
          }
        }

        const handleNonce = randomNonce()
        if (!HANDLE_DIGEST.test(handleNonce)) return { ok: false, code: 'unavailable' }
        const handle = deps.keys.sign('review-sync-cursor-handle-v1', handleNonce)
        const nextCursorRef = `${handle.keyVersion}.${handle.digest}`
        const nextTokenHmac = deps.keys.sign(
          'review-sync-next-token-v1',
          input.nextPageToken,
        )
        const record: CursorRecord = {
          schemaVersion: 2,
          audience: 'review_sync_cursor',
          keyVersion: handle.keyVersion,
          handleNonce,
          issuedAtMs: atMs,
          expiresAtMs,
          scope: input.nextScope,
          authorization: input.authorization,
          pageToken: input.nextPageToken,
          remainingRedemptions: MAX_CURSOR_REDEMPTIONS,
          child: null,
        }
        const link: PageLink = {
          schemaVersion: 2,
          audience: 'review_sync_cursor_page_link',
          scope: input.scope,
          authorization: input.authorization,
          nextTokenHmacKeyVersion: nextTokenHmac.keyVersion,
          nextTokenHmac: nextTokenHmac.digest,
          nextCursorRef,
          expiresAtMs,
        }
        const recordEncoded = encode(record)
        const linkEncoded = encode(link)
        const additions = [
          { key: handle.digest, bytes: Buffer.byteLength(recordEncoded) },
          { key: linkKey, bytes: Buffer.byteLength(linkEncoded) },
        ]
        const nextRunIndex = appendEntries(
          runIndex.value,
          additions,
          MAX_RUN_RECORDS - otherRunEntries.length,
          MAX_RUN_BYTES - totalBytes(otherRunEntries),
        )
        const nextOrgIndex = appendEntries(
          orgIndex.value,
          additions,
          MAX_ORGANIZATION_RECORDS - otherOrgEntries.length,
          MAX_ORGANIZATION_BYTES - totalBytes(otherOrgEntries),
        )
        if (!nextRunIndex || !nextOrgIndex) {
          return { ok: false, code: 'capacity_exceeded' }
        }
        const parentNext = parent
          ? encode({
              ...parent.record,
              child: {
                cursorRef: nextCursorRef,
                nextTokenHmacKeyVersion: nextTokenHmac.keyVersion,
                nextTokenHmac: nextTokenHmac.digest,
              },
            } satisfies CursorRecord)
          : null
        const applied = await deps.store.compareAndSwapMany(NAMESPACE, [
          {
            key: handle.digest,
            expectedValue: null,
            next: { value: recordEncoded, ttlSeconds: CURSOR_TTL_SECONDS },
          },
          {
            key: linkKey,
            expectedValue: null,
            next: { value: linkEncoded, ttlSeconds: CURSOR_TTL_SECONDS },
          },
          {
            key: runKey,
            expectedValue: runIndex.encoded,
            next: { value: encode(nextRunIndex), ttlSeconds: CURSOR_TTL_SECONDS },
          },
          {
            key: orgKey,
            expectedValue: orgIndex.encoded,
            next: { value: encode(nextOrgIndex), ttlSeconds: CURSOR_TTL_SECONDS },
          },
          ...(parent && parentNext
            ? [
                {
                  key: parent.key,
                  expectedValue: parent.encoded,
                  next: {
                    value: parentNext,
                    ttlSeconds: ttlSeconds(parent.record.expiresAtMs, atMs),
                  },
                },
              ]
            : []),
        ])
        if (applied) return { ok: true, value: { nextCursorRef } }
      }
      return { ok: false, code: 'conflict' }
    },

    discardRun: async (input) => {
      const baseScope = {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        sourceEpoch: input.sourceEpoch,
        runId: input.runId,
      }
      if (
        !SAFE_SCOPE_ID.test(input.organizationId) ||
        !UUID.test(input.propertyId) ||
        !UUID.test(input.runId) ||
        !Number.isSafeInteger(input.sourceEpoch) ||
        input.sourceEpoch < 0
      ) {
        throw new Error('review cursor cleanup scope is malformed')
      }
      for (const keyVersion of keyVersions) {
        const runKey = keyForVersion(
          deps.keys,
          'review-sync-run-index-v1',
          baseScope,
          keyVersion,
        )
        const orgKey = keyForVersion(
          deps.keys,
          'review-sync-org-index-v1',
          input.organizationId,
          keyVersion,
        )
        if (!runKey || !orgKey) return false
        const runIndex = await loadIndex(runKey, 'review_sync_cursor_run_index')
        if (!runIndex) return false
        if (runIndex.encoded === null) continue
        let cleanupIndex = runIndex.value
        if (!cleanupIndex.invalidated) {
          const orgIndex = await loadIndex(orgKey, 'review_sync_cursor_org_index')
          if (!orgIndex) return false
          const removedKeys = new Set(cleanupIndex.entries.map((entry) => entry.key))
          const nextOrg: CursorIndex = {
            ...orgIndex.value,
            entries: orgIndex.value.entries.filter(
              (entry) => !removedKeys.has(entry.key),
            ),
          }
          const tombstone: CursorIndex = { ...cleanupIndex, invalidated: true }
          const applied = await deps.store.compareAndSwapMany(NAMESPACE, [
            {
              key: runKey,
              expectedValue: runIndex.encoded,
              next: { value: encode(tombstone), ttlSeconds: CURSOR_TTL_SECONDS },
            },
            {
              key: orgKey,
              expectedValue: orgIndex.encoded,
              next: { value: encode(nextOrg), ttlSeconds: CURSOR_TTL_SECONDS },
            },
          ])
          if (!applied) return false
          cleanupIndex = tombstone
        }
        for (const entry of cleanupIndex.entries) {
          await deps.store.remove(NAMESPACE, entry.key)
        }
        const latest = await deps.store.read(NAMESPACE, runKey)
        if (latest) await deps.store.consumeIfEquals(NAMESPACE, runKey, latest)
      }
      return true
    },

    startedAtMs: () => deps.store.startedAtMs(),
  })
}

export const createUnavailableGoogleReviewCursorStore = (): GoogleReviewCursorStore => {
  const unavailable = Object.freeze({ ok: false as const, code: 'unavailable' as const })
  return Object.freeze({
    redeem: async () => unavailable,
    release: async () => unavailable,
    publishNext: async () => unavailable,
    discardRun: async () => false,
    startedAtMs: async () => null,
  })
}
