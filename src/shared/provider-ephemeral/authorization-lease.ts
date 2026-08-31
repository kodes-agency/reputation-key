import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod/v4'
import type { GoogleContentCapability } from '#/shared/auth/google-content-contract'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/auth/google-content-contract'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderEphemeralStore } from './provider-ephemeral-store'

const HANDLE_AUDIENCE = 'provider-authorization-lease-handle-v1'
const HANDLE = /^l1\.([A-Za-z0-9_-]{43})\.([a-z][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{43})$/
const DIGEST = /^[A-Za-z0-9_-]{43}$/
const MAX_LEASE_TTL_MS = 30_000
const MAX_CONTENT_LIFETIME_MS = Object.freeze({
  import: 24 * 60 * 60_000,
  performance: 15 * 60_000,
})

const leaseRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    audience: z.enum(['import', 'performance']),
    capability: z.enum(GOOGLE_CONTENT_CAPABILITIES),
    organizationId: z.string().min(1).max(255),
    initiatorUserId: z.string().min(1).max(255),
    propertyId: z.uuid().nullable(),
    connectionId: z.uuid(),
    approvalBindingId: z.uuid(),
    principalHmacKeyVersion: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    principalHmac: z.string().regex(DIGEST),
    authorizationFenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    issuedAtMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expiresAtMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    absoluteDeadlineMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict()

export type ProviderAuthorizationLeaseRecord = Readonly<z.infer<typeof leaseRecordSchema>>

export type ProviderAuthorizationLeaseRejection =
  | 'malformed'
  | 'not_found'
  | 'expired'
  | 'principal_mismatch'
  | 'authorization_denied'
  | 'authorization_changed'
  | 'concurrent_update'
  | 'runtime_unavailable'

export type ProviderAuthorizationLeaseResult =
  | Readonly<{ ok: true; lease: ProviderContentLeaseDto }>
  | Readonly<{ ok: false; code: ProviderAuthorizationLeaseRejection }>

export type ProviderAuthorizationLeaseService = Readonly<{
  issue(
    input: Readonly<{
      audience: 'import' | 'performance'
      capability: GoogleContentCapability
      organizationId: string
      initiatorUserId: string
      propertyId: string | null
      connectionId: string
      approvalBindingId: string
      principalHmacKeyVersion: string
      principalHmac: string
      authorizationFenceSha256: string
      absoluteDeadlineMs: number
      nowMs: number
    }>,
  ): Promise<ProviderAuthorizationLeaseResult>
  renew(
    input: Readonly<{
      leaseRef: string
      principalHmacKeyVersion: string
      principalHmac: string
      approvalBindingId: string
      authorizationFenceSha256: string
      nowMs: number
    }>,
  ): Promise<ProviderAuthorizationLeaseResult>
  invalidate(leaseRef: string): Promise<void>
}>

function same(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseHandle(
  handle: string,
  keys: VersionedHmacKeyring,
): Readonly<{ storeKey: string }> | null {
  const match = HANDLE.exec(handle)
  if (!match) return null
  const [, nonce, keyVersion, digest] = match
  if (!keys.verify(HANDLE_AUDIENCE, nonce!, keyVersion!, digest!)) return null
  return { storeKey: digest! }
}

function dto(
  handle: string,
  expiresAtMs: number,
  nowMs: number,
): ProviderContentLeaseDto {
  return Object.freeze({
    leaseRef: handle,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlSeconds: Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1_000)),
    renewAfterMs: 10_000,
  })
}

function validTime(
  audience: ProviderAuthorizationLeaseRecord['audience'],
  nowMs: number,
  absoluteDeadlineMs: number,
): boolean {
  return (
    Number.isSafeInteger(nowMs) &&
    Number.isSafeInteger(absoluteDeadlineMs) &&
    nowMs >= 0 &&
    absoluteDeadlineMs > nowMs &&
    absoluteDeadlineMs <= nowMs + MAX_CONTENT_LIFETIME_MS[audience]
  )
}

export function createProviderAuthorizationLeaseService(
  deps: Readonly<{
    store: ProviderEphemeralStore
    handleKeys: VersionedHmacKeyring
    randomNonce: () => string
    ensureRuntimeReady?: () => Promise<void>
    revalidate: (record: ProviderAuthorizationLeaseRecord) => Promise<
      Readonly<{
        allowed: boolean
        approvalBindingId: string | null
        authorizationFenceSha256: string | null
      }>
    >
  }>,
): ProviderAuthorizationLeaseService {
  const ready = async (): Promise<boolean> => {
    try {
      await deps.ensureRuntimeReady?.()
      return true
    } catch {
      return false
    }
  }

  return Object.freeze({
    issue: async (input) => {
      if (!(await ready())) return { ok: false, code: 'runtime_unavailable' }
      const nonce = deps.randomNonce()
      if (
        !DIGEST.test(nonce) ||
        !validTime(input.audience, input.nowMs, input.absoluteDeadlineMs)
      ) {
        return { ok: false, code: 'malformed' }
      }
      const signed = deps.handleKeys.sign(HANDLE_AUDIENCE, nonce)
      if (signed.keyVersion !== deps.handleKeys.activeVersion) {
        return { ok: false, code: 'runtime_unavailable' }
      }
      const handle = `l1.${nonce}.${signed.keyVersion}.${signed.digest}`
      const expiresAtMs = Math.min(
        input.nowMs + MAX_LEASE_TTL_MS,
        input.absoluteDeadlineMs,
      )
      const parsed = leaseRecordSchema.safeParse({
        schemaVersion: 1,
        audience: input.audience,
        capability: input.capability,
        organizationId: input.organizationId,
        initiatorUserId: input.initiatorUserId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        approvalBindingId: input.approvalBindingId,
        principalHmacKeyVersion: input.principalHmacKeyVersion,
        principalHmac: input.principalHmac,
        authorizationFenceSha256: input.authorizationFenceSha256,
        generation: 1,
        issuedAtMs: input.nowMs,
        expiresAtMs,
        absoluteDeadlineMs: input.absoluteDeadlineMs,
      })
      if (!parsed.success) return { ok: false, code: 'malformed' }
      let authorization: Awaited<ReturnType<typeof deps.revalidate>>
      try {
        authorization = await deps.revalidate(parsed.data)
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
      if (!authorization.allowed) {
        return { ok: false, code: 'authorization_denied' }
      }
      if (
        authorization.approvalBindingId !== parsed.data.approvalBindingId ||
        authorization.authorizationFenceSha256 !== parsed.data.authorizationFenceSha256
      ) {
        return { ok: false, code: 'authorization_changed' }
      }
      const ttlSeconds = Math.max(1, Math.ceil((expiresAtMs - input.nowMs) / 1_000))
      try {
        const stored = await deps.store.putIfAbsent(
          'authorization-lease',
          signed.digest,
          JSON.stringify(parsed.data),
          ttlSeconds,
        )
        return stored
          ? { ok: true, lease: dto(handle, expiresAtMs, input.nowMs) }
          : { ok: false, code: 'concurrent_update' }
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
    },

    renew: async (input) => {
      if (!(await ready())) return { ok: false, code: 'runtime_unavailable' }
      const parsedHandle = parseHandle(input.leaseRef, deps.handleKeys)
      if (!parsedHandle || !Number.isSafeInteger(input.nowMs)) {
        return { ok: false, code: 'malformed' }
      }
      let encoded: string | undefined
      try {
        encoded = await deps.store.read('authorization-lease', parsedHandle.storeKey)
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
      if (!encoded) return { ok: false, code: 'not_found' }
      let candidate: unknown
      try {
        candidate = JSON.parse(encoded)
      } catch {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'malformed' }
      }
      const parsedRecord = leaseRecordSchema.safeParse(candidate)
      if (!parsedRecord.success) {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'malformed' }
      }
      const record = parsedRecord.data
      if (record.expiresAtMs <= input.nowMs || record.absoluteDeadlineMs <= input.nowMs) {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'expired' }
      }
      if (
        record.principalHmacKeyVersion !== input.principalHmacKeyVersion ||
        !DIGEST.test(input.principalHmac) ||
        !same(record.principalHmac, input.principalHmac)
      ) {
        return { ok: false, code: 'principal_mismatch' }
      }
      if (
        !leaseRecordSchema.shape.approvalBindingId.safeParse(input.approvalBindingId)
          .success ||
        !leaseRecordSchema.shape.authorizationFenceSha256.safeParse(
          input.authorizationFenceSha256,
        ).success
      ) {
        return { ok: false, code: 'malformed' }
      }
      if (
        record.approvalBindingId !== input.approvalBindingId ||
        record.authorizationFenceSha256 !== input.authorizationFenceSha256
      ) {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'authorization_changed' }
      }
      let authorization: Awaited<ReturnType<typeof deps.revalidate>>
      try {
        authorization = await deps.revalidate(record)
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
      if (!authorization.allowed) {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'authorization_denied' }
      }
      if (
        authorization.approvalBindingId !== record.approvalBindingId ||
        authorization.authorizationFenceSha256 !== record.authorizationFenceSha256
      ) {
        await deps.store.remove('authorization-lease', parsedHandle.storeKey)
        return { ok: false, code: 'authorization_changed' }
      }
      const expiresAtMs = Math.min(
        input.nowMs + MAX_LEASE_TTL_MS,
        record.absoluteDeadlineMs,
      )
      const next = leaseRecordSchema.parse({
        ...record,
        generation: record.generation + 1,
        expiresAtMs,
      })
      const ttlSeconds = Math.max(1, Math.ceil((expiresAtMs - input.nowMs) / 1_000))
      try {
        const replaced = await deps.store.replaceIfEquals(
          'authorization-lease',
          parsedHandle.storeKey,
          encoded,
          JSON.stringify(next),
          ttlSeconds,
        )
        return replaced === 'replaced'
          ? { ok: true, lease: dto(input.leaseRef, expiresAtMs, input.nowMs) }
          : {
              ok: false,
              code: replaced === 'not_found' ? 'not_found' : 'concurrent_update',
            }
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
    },

    invalidate: async (leaseRef) => {
      const parsed = parseHandle(leaseRef, deps.handleKeys)
      if (!parsed) return
      await deps.store.remove('authorization-lease', parsed.storeKey)
    },
  })
}
