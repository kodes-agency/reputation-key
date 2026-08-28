import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
export type OAuthVerifierMaterialV2 = Readonly<{
  contractVersion: 'v2'
  codeVerifier: string
  oidcNonce: string
}>

const oauthStateRecordSchema = z
  .object({
    version: z.literal(2),
    state: z.literal('issued'),
    exchangeAttemptId: z.uuid(),
    organizationId: z.string().min(1).max(255),
    userId: z.string().min(1).max(255),
    audience: z.literal('google-connect'),
    visibility: z.enum(['private', 'organization']),
    purpose: z.enum(['reviews', 'import_gbp_v2', 'performance_reauth']),
    connectionMode: z.enum(['new', 'reauth', 'reconnect']),
    targetConnectionId: z.string().min(1).max(255).nullable(),
    returnRoute: z.literal('/properties/import-google'),
    sessionBindingKeyVersion: z.string().min(1).max(32),
    sessionBindingDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    oidcNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    codeVerifier: z.string().min(43).max(128),
    issuedAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().positive(),
  })
  .strict()

const oauthStateRecoveryTombstoneSchema = z
  .object({
    version: z.literal(2),
    state: z.literal('redeemed'),
    exchangeAttemptId: z.uuid(),
    organizationId: z.string().min(1).max(255),
    userId: z.string().min(1).max(255),
    audience: z.literal('google-connect-recovery'),
    returnRoute: z.literal('/properties/import-google'),
    sessionBindingKeyVersion: z.string().min(1).max(32),
    sessionBindingDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    issuedAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().positive(),
  })
  .strict()

export type OAuthStateHandleRecord = z.infer<typeof oauthStateRecordSchema>
type OAuthStateRecoveryTombstone = z.infer<typeof oauthStateRecoveryTombstoneSchema>
export type OAuthStateHandleRejection =
  'malformed' | 'not_found' | 'expired' | 'binding_mismatch' | 'replayed'

export type OAuthStateHandleService = Readonly<{
  issue: (
    input: Readonly<{
      organizationId: string
      userId: string
      sessionId: string
      visibility: 'private' | 'organization'
      purpose: 'reviews' | 'import_gbp_v2' | 'performance_reauth'
      connectionMode: 'new' | 'reauth' | 'reconnect'
      targetConnectionId: string | null
      nowMs: number
      codeVerifier: string
      oidcNonce: string
    }>,
  ) => Promise<string>
  redeem: (
    input: Readonly<{
      handle: string
      organizationId: string
      userId: string
      sessionId: string
      nowMs: number
    }>,
  ) => Promise<
    | Readonly<{
        ok: true
        kind: 'exchange'
        exchangeAttemptId: string
        visibility: 'private' | 'organization'
        purpose: 'reviews' | 'import_gbp_v2' | 'performance_reauth'
        connectionMode: 'new' | 'reauth' | 'reconnect'
        targetConnectionId: string | null
        returnRoute: '/properties/import-google'
        verifierMaterial: OAuthVerifierMaterialV2
      }>
    | Readonly<{
        ok: true
        kind: 'recovery'
        exchangeAttemptId: string
        returnRoute: '/properties/import-google'
      }>
    | Readonly<{ ok: false; code: OAuthStateHandleRejection }>
  >
}>

const HANDLE_AUDIENCE = 'google-oauth-state-handle'
const SESSION_AUDIENCE = 'oauth-session-binding'

function recordKey(handle: string): string {
  return createHash('sha256').update(handle).digest('base64url')
}

export function createOAuthStateHandleService(
  deps: Readonly<{
    store: ProviderEphemeralStore
    handleKeys: VersionedHmacKeyring
    sessionKeys: VersionedHmacKeyring
    random?: (bytes: number) => Buffer
    newExchangeAttemptId?: () => string
    ensureRuntimeReady?: () => Promise<void>
  }>,
): OAuthStateHandleService {
  const random = deps.random ?? randomBytes
  const newExchangeAttemptId = deps.newExchangeAttemptId ?? randomUUID

  const parseHandle = (handle: string): boolean => {
    const parts = handle.split('.')
    if (parts.length !== 4 || parts[0] !== 'v2') return false
    const [, keyVersion, nonce, digest] = parts
    if (!keyVersion || !nonce || !digest || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
      return false
    }
    return deps.handleKeys.verify(
      HANDLE_AUDIENCE,
      `v2.${keyVersion}.${nonce}`,
      keyVersion,
      digest,
    )
  }

  const parseRecord = (
    encoded: string,
  ): OAuthStateHandleRecord | OAuthStateRecoveryTombstone | null => {
    try {
      const value: unknown = JSON.parse(encoded)
      const issued = oauthStateRecordSchema.safeParse(value)
      if (issued.success) return issued.data
      const recovered = oauthStateRecoveryTombstoneSchema.safeParse(value)
      return recovered.success ? recovered.data : null
    } catch {
      return null
    }
  }

  return Object.freeze({
    issue: async (input) => {
      await deps.ensureRuntimeReady?.()
      const nonce = random(32).toString('base64url')
      const prefix = `v2.${deps.handleKeys.activeVersion}.${nonce}`
      const signed = deps.handleKeys.sign(HANDLE_AUDIENCE, prefix)
      if (signed.keyVersion !== deps.handleKeys.activeVersion) {
        throw new Error('OAuth handle keyring active version changed during issuance')
      }
      const handle = `${prefix}.${signed.digest}`
      const sessionBinding = deps.sessionKeys.sign(SESSION_AUDIENCE, input.sessionId)
      if (
        (input.connectionMode === 'new' && input.targetConnectionId !== null) ||
        (input.connectionMode !== 'new' && input.targetConnectionId === null)
      ) {
        throw new Error('OAuth connection mode and target are inconsistent')
      }
      const record: OAuthStateHandleRecord = {
        version: 2,
        state: 'issued',
        exchangeAttemptId: newExchangeAttemptId(),
        organizationId: input.organizationId,
        userId: input.userId,
        audience: 'google-connect',
        visibility: input.visibility,
        purpose: input.purpose,
        connectionMode: input.connectionMode,
        targetConnectionId: input.targetConnectionId,
        returnRoute: '/properties/import-google',
        sessionBindingKeyVersion: sessionBinding.keyVersion,
        sessionBindingDigest: sessionBinding.digest,
        oidcNonce: input.oidcNonce,
        codeVerifier: input.codeVerifier,
        issuedAtMs: input.nowMs,
        expiresAtMs: input.nowMs + 600_000,
      }
      const inserted = await deps.store.putIfAbsent(
        'oauth-state',
        recordKey(handle),
        JSON.stringify(record),
        600,
      )
      if (!inserted) throw new Error('OAuth state handle collision')
      return handle
    },

    redeem: async (input) => {
      await deps.ensureRuntimeReady?.()
      if (!parseHandle(input.handle)) return { ok: false, code: 'malformed' }
      const key = recordKey(input.handle)
      const encoded = await deps.store.read('oauth-state', key)
      if (!encoded) return { ok: false, code: 'not_found' }
      const record = parseRecord(encoded)
      if (!record) return { ok: false, code: 'malformed' }
      if (record.expiresAtMs <= input.nowMs || record.issuedAtMs > input.nowMs + 60_000) {
        await deps.store.remove('oauth-state', key)
        return { ok: false, code: 'expired' }
      }
      const sessionMatches = deps.sessionKeys.verify(
        SESSION_AUDIENCE,
        input.sessionId,
        record.sessionBindingKeyVersion,
        record.sessionBindingDigest,
      )
      if (
        !sessionMatches ||
        record.organizationId !== input.organizationId ||
        record.userId !== input.userId
      ) {
        return { ok: false, code: 'binding_mismatch' }
      }
      if (record.state === 'redeemed') {
        return {
          ok: true,
          kind: 'recovery',
          exchangeAttemptId: record.exchangeAttemptId,
          returnRoute: record.returnRoute,
        }
      }
      const tombstone: OAuthStateRecoveryTombstone = {
        version: 2,
        state: 'redeemed',
        exchangeAttemptId: record.exchangeAttemptId,
        organizationId: record.organizationId,
        userId: record.userId,
        audience: 'google-connect-recovery',
        returnRoute: record.returnRoute,
        sessionBindingKeyVersion: record.sessionBindingKeyVersion,
        sessionBindingDigest: record.sessionBindingDigest,
        issuedAtMs: record.issuedAtMs,
        expiresAtMs: record.expiresAtMs,
      }
      const replacement = await deps.store.replaceIfEquals(
        'oauth-state',
        key,
        encoded,
        JSON.stringify(tombstone),
        Math.max(1, Math.ceil((record.expiresAtMs - input.nowMs) / 1_000)),
      )
      if (replacement === 'not_found') return { ok: false, code: 'replayed' }
      if (replacement === 'mismatch') {
        const raced = await deps.store.read('oauth-state', key)
        const parsedRace = raced ? parseRecord(raced) : null
        return parsedRace?.state === 'redeemed' &&
          parsedRace.organizationId === input.organizationId &&
          parsedRace.userId === input.userId
          ? {
              ok: true,
              kind: 'recovery',
              exchangeAttemptId: parsedRace.exchangeAttemptId,
              returnRoute: parsedRace.returnRoute,
            }
          : { ok: false, code: 'replayed' }
      }
      return {
        ok: true,
        kind: 'exchange',
        exchangeAttemptId: record.exchangeAttemptId,
        visibility: record.visibility,
        purpose: record.purpose,
        connectionMode: record.connectionMode,
        targetConnectionId: record.targetConnectionId,
        returnRoute: record.returnRoute,
        verifierMaterial: {
          contractVersion: 'v2',
          codeVerifier: record.codeVerifier,
          oidcNonce: record.oidcNonce,
        },
      }
    },
  })
}
