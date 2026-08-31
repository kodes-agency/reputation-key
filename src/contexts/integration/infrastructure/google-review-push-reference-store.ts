import { randomBytes } from 'node:crypto'
import { z } from 'zod/v4'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  GoogleReviewPushReferenceStore,
  GoogleReviewPushScope,
} from '../application/ports/google-review-push-reference.port'

const NAMESPACE = 'opaque-reference' as const
const REFERENCE_TTL_SECONDS = 15 * 60
const MAX_REDEMPTIONS = 10
const MAX_PUBLICATION_ATTEMPTS = 3
const MAX_CLOCK_SKEW_MS = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u
const KEY_VERSION = /^[a-z][a-z0-9_-]{0,31}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const HANDLE = /^([a-z][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{43})$/u

const scopeSchema = z
  .object({
    organizationId: z.string().regex(SAFE_SCOPE_ID),
    propertyId: z.string().regex(UUID),
    connectionId: z.string().regex(UUID),
    sourceEpoch: z.number().int().safe().nonnegative(),
  })
  .strict()

const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    audience: z.literal('gbp_review_push_target'),
    keyVersion: z.string().regex(KEY_VERSION),
    handleNonce: z.string().regex(DIGEST),
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().positive(),
    remainingRedemptions: z.number().int().min(0).max(MAX_REDEMPTIONS),
    scope: scopeSchema,
    locationName: z.string().min(1).max(768),
    reviewName: z.string().min(1).max(1_024),
  })
  .strict()

type PushReferenceRecord = z.infer<typeof recordSchema>

function assertScope(scope: GoogleReviewPushScope): void {
  if (!scopeSchema.safeParse(scope).success) {
    throw new TypeError('Google review push scope is malformed')
  }
}

function assertTarget(locationName: string, reviewName: string): void {
  const resource = parseReviewProviderResource(reviewName)
  const embeddedLocation = `accounts/${resource.accountId}/locations/${resource.locationId}`
  if (embeddedLocation !== locationName) {
    throw new TypeError('Google review push resource mismatch')
  }
}

function parseRecord(encoded: string): PushReferenceRecord | null {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(encoded))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function sameScope(left: GoogleReviewPushScope, right: GoogleReviewPushScope): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.propertyId === right.propertyId &&
    left.connectionId === right.connectionId &&
    left.sourceEpoch === right.sourceEpoch
  )
}

function ttlSeconds(expiresAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1_000))
}

export const createGoogleReviewPushReferenceStore = (
  deps: Readonly<{
    store: ProviderEphemeralStore
    keys: VersionedHmacKeyring
    nowMs?: () => number
    randomNonce?: () => string
  }>,
): GoogleReviewPushReferenceStore => {
  const nowMs = deps.nowMs ?? Date.now
  const randomNonce = deps.randomNonce ?? (() => randomBytes(32).toString('base64url'))

  return Object.freeze({
    publish: async (input) => {
      assertScope(input.scope)
      assertTarget(input.locationName, input.reviewName)
      for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
        const handleNonce = randomNonce()
        if (!DIGEST.test(handleNonce)) {
          throw new TypeError('Google review push reference nonce is malformed')
        }
        const signed = deps.keys.sign('gbp-review-push-reference-v1', handleNonce)
        const issuedAtMs = nowMs()
        const record: PushReferenceRecord = {
          schemaVersion: 1,
          audience: 'gbp_review_push_target',
          keyVersion: signed.keyVersion,
          handleNonce,
          issuedAtMs,
          expiresAtMs: issuedAtMs + REFERENCE_TTL_SECONDS * 1_000,
          remainingRedemptions: MAX_REDEMPTIONS,
          scope: input.scope,
          locationName: input.locationName,
          reviewName: input.reviewName,
        }
        try {
          const inserted = await deps.store.putIfAbsent(
            NAMESPACE,
            signed.digest,
            JSON.stringify(record),
            REFERENCE_TTL_SECONDS,
          )
          if (inserted) {
            return {
              ok: true,
              referenceRef: `${signed.keyVersion}.${signed.digest}`,
            } as const
          }
        } catch {
          return { ok: false, code: 'unavailable' } as const
        }
      }
      return { ok: false, code: 'capacity_exceeded' } as const
    },

    resolve: async (input) => {
      assertScope(input.scope)
      const match = HANDLE.exec(input.referenceRef)
      if (!match) return { ok: false, code: 'not_found' } as const
      const [, keyVersion, key] = match
      let encoded: string | undefined
      try {
        encoded = await deps.store.read(NAMESPACE, key!)
      } catch {
        return { ok: false, code: 'unavailable' } as const
      }
      if (!encoded) return { ok: false, code: 'not_found' } as const
      const record = parseRecord(encoded)
      if (
        !record ||
        record.keyVersion !== keyVersion ||
        !deps.keys.verify(
          'gbp-review-push-reference-v1',
          record.handleNonce,
          record.keyVersion,
          key!,
        )
      ) {
        return { ok: false, code: 'not_found' } as const
      }
      const atMs = nowMs()
      if (record.expiresAtMs <= atMs || record.issuedAtMs > atMs + MAX_CLOCK_SKEW_MS) {
        await deps.store.consumeIfEquals(NAMESPACE, key!, encoded).catch(() => undefined)
        return { ok: false, code: 'expired' } as const
      }
      if (!sameScope(record.scope, input.scope)) {
        return { ok: false, code: 'binding_mismatch' } as const
      }
      if (record.remainingRedemptions === 0) {
        return { ok: false, code: 'exhausted' } as const
      }
      const next: PushReferenceRecord = {
        ...record,
        remainingRedemptions: record.remainingRedemptions - 1,
      }
      let replaced: Awaited<ReturnType<ProviderEphemeralStore['replaceIfEquals']>>
      try {
        replaced = await deps.store.replaceIfEquals(
          NAMESPACE,
          key!,
          encoded,
          JSON.stringify(next),
          ttlSeconds(next.expiresAtMs, atMs),
        )
      } catch {
        return { ok: false, code: 'unavailable' } as const
      }
      if (replaced !== 'replaced') {
        return {
          ok: false,
          code: replaced === 'not_found' ? 'not_found' : 'conflict',
        } as const
      }
      return {
        ok: true,
        target: {
          locationName: record.locationName,
          reviewName: record.reviewName,
        },
      } as const
    },
  })
}
