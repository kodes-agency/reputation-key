import { z } from 'zod'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  type GoogleInFlightKey,
  type GoogleInFlightLease,
  type GoogleProviderRouteKey,
  type GoogleQuotaKey,
} from './contracts'

export type GoogleAdmissionGrant = Readonly<{
  admissionId: string
  permitId: string
  routeKey: GoogleProviderRouteKey
  routeCatalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  gatewayIdentity: string
  requestBindingSha256: string
  credentialBinding: string
  expiresAtMs: number
  signatureKeyVersion: string
  signature: string
}>

export type GoogleAdmissionGrantRecord = Readonly<{
  grant: GoogleAdmissionGrant
  state: 'issued' | 'redeemed'
  quotaKey: GoogleQuotaKey
  authorityRevision: string
  inFlightKey: GoogleInFlightKey
  inFlightLease: GoogleInFlightLease
}>

export type GoogleAdmissionGrantStore = Readonly<{
  issue(record: GoogleAdmissionGrantRecord): Promise<boolean>
  redeem(
    admissionId: string,
    expectedSignature: string,
    nowMs: number,
  ): Promise<'unknown' | 'expired' | 'replayed' | 'mismatch' | GoogleAdmissionGrantRecord>
  complete(admissionId: string): Promise<GoogleAdmissionGrantRecord | null>
}>

export type GoogleAdmissionGrantRedis = Readonly<{
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    expiryMs: number,
    condition: 'NX',
  ): Promise<'OK' | null>
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>
}>

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const SAFE_ADMISSION_ID = /^[A-Za-z0-9_-]{16,128}$/
const grantSchema = z
  .object({
    admissionId: z.string().regex(SAFE_ADMISSION_ID),
    permitId: z.string().regex(SAFE_ID),
    routeKey: z.enum(GOOGLE_PROVIDER_ROUTE_KEYS),
    routeCatalogueVersion: z.literal(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION),
    gatewayIdentity: z.string().regex(SAFE_ID),
    requestBindingSha256: z.string().regex(SHA256),
    credentialBinding: z.union([z.literal('none'), z.string().regex(SHA256)]),
    expiresAtMs: z.number().int().safe().positive(),
    signatureKeyVersion: z.string().min(1).max(32),
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
const quotaKeySchema = z
  .object({
    credentialFingerprint: z.string().regex(SHA256),
    projectFingerprint: z.string().regex(SHA256),
    endpointClass: z.enum([
      'account-management',
      'business-information',
      'performance',
      'oauth-token',
      'oauth-jwks',
      'oauth-revoke',
      'reviews',
      'notifications',
    ]),
    organizationId: z.string().regex(SAFE_ID),
    initiatorUserId: z.union([z.null(), z.string().regex(SAFE_ID)]),
    connectionId: z.union([z.null(), z.string().regex(SAFE_ID)]),
    propertyId: z.union([z.null(), z.string().regex(SAFE_ID)]),
  })
  .strict()
const inFlightKeySchema = quotaKeySchema
  .extend({
    requestClass: z.enum([
      'identity',
      'discovery',
      'performance',
      'credential_refresh',
      'credential_cleanup',
      'reviews',
      'notifications',
    ]),
  })
  .strict()
const leaseSchema = z
  .object({
    leaseId: z.string().min(16).max(128),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
const recordSchema = z
  .object({
    grant: grantSchema,
    state: z.enum(['issued', 'redeemed']),
    quotaKey: quotaKeySchema,
    inFlightKey: inFlightKeySchema,
    inFlightLease: leaseSchema,
    authorityRevision: z.string().regex(SAFE_ID),
  })
  .strict()

const REDEEM_SCRIPT = `-- google-admission-grant-redeem-v1
local raw = redis.call('GET', KEYS[1])
if not raw then return {0, ''} end
local record = cjson.decode(raw)
if record.grant.signature ~= ARGV[1] then return {-1, ''} end
if record.state ~= 'issued' then return {-2, ''} end
if tonumber(record.grant.expiresAtMs) <= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {-3, ''}
end
record.state = 'redeemed'
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'PX', tonumber(ARGV[3]))
return {1, encoded}
`

const COMPLETE_SCRIPT = `-- google-admission-grant-complete-v1
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local record = cjson.decode(raw)
if record.state ~= 'redeemed' then return '' end
redis.call('DEL', KEYS[1])
return raw
`

function grantKey(admissionId: string): string {
  if (!SAFE_ADMISSION_ID.test(admissionId)) {
    throw new Error('admission grant identifier is invalid')
  }
  return `google-admission:{${admissionId}}:grant`
}

function parseRecord(raw: unknown): GoogleAdmissionGrantRecord | null {
  if (typeof raw !== 'string' || raw.length > 8 * 1024) return null
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function unsignedGrantValue(
  grant: Omit<GoogleAdmissionGrant, 'signatureKeyVersion' | 'signature'>,
): string {
  return JSON.stringify([
    grant.admissionId,
    grant.permitId,
    grant.routeKey,
    grant.routeCatalogueVersion,
    grant.gatewayIdentity,
    grant.requestBindingSha256,
    grant.credentialBinding,
    grant.expiresAtMs,
  ])
}

export function signGoogleAdmissionGrant(
  grant: Omit<GoogleAdmissionGrant, 'signatureKeyVersion' | 'signature'>,
  keyring: VersionedHmacKeyring,
): GoogleAdmissionGrant {
  const signature = keyring.sign(
    'google-execution-admission-grant-v1',
    unsignedGrantValue(grant),
  )
  return Object.freeze({
    ...grant,
    signatureKeyVersion: signature.keyVersion,
    signature: signature.digest,
  })
}

export function verifyGoogleAdmissionGrant(
  grant: GoogleAdmissionGrant,
  keyring: VersionedHmacKeyring,
): boolean {
  const parsed = grantSchema.safeParse(grant)
  if (!parsed.success) return false
  return keyring.verify(
    'google-execution-admission-grant-v1',
    unsignedGrantValue(grant),
    grant.signatureKeyVersion,
    grant.signature,
  )
}

export function parseGoogleAdmissionGrant(value: unknown): GoogleAdmissionGrant {
  const parsed = grantSchema.safeParse(value)
  if (!parsed.success) throw new Error('admission grant is invalid')
  return parsed.data
}

export function createInMemoryGoogleAdmissionGrantStore(
  nowMs: () => number,
): GoogleAdmissionGrantStore {
  const records = new Map<string, GoogleAdmissionGrantRecord>()
  return Object.freeze({
    issue: async (record) => {
      if (!recordSchema.safeParse(record).success) return false
      if (record.grant.expiresAtMs <= nowMs() || records.has(record.grant.admissionId)) {
        return false
      }
      records.set(record.grant.admissionId, record)
      return true
    },
    redeem: async (admissionId, expectedSignature, currentMs) => {
      const record = records.get(admissionId)
      if (!record) return 'unknown'
      if (record.grant.signature !== expectedSignature) return 'mismatch'
      if (record.state !== 'issued') return 'replayed'
      if (record.grant.expiresAtMs <= currentMs) {
        records.delete(admissionId)
        return 'expired'
      }
      const redeemed = Object.freeze({ ...record, state: 'redeemed' as const })
      records.set(admissionId, redeemed)
      return redeemed
    },
    complete: async (admissionId) => {
      const record = records.get(admissionId)
      if (!record || record.state !== 'redeemed') return null
      records.delete(admissionId)
      return record
    },
  })
}

export function createRedisGoogleAdmissionGrantStore(
  redis: GoogleAdmissionGrantRedis,
  nowMs: () => number,
): GoogleAdmissionGrantStore {
  return Object.freeze({
    issue: async (record) => {
      const parsed = recordSchema.safeParse(record)
      const ttlMs = record.grant.expiresAtMs - nowMs()
      if (!parsed.success || ttlMs < 1 || ttlMs > 60_000) return false
      try {
        return (
          (await redis.set(
            grantKey(record.grant.admissionId),
            JSON.stringify(record),
            'PX',
            ttlMs,
            'NX',
          )) === 'OK'
        )
      } catch {
        return false
      }
    },
    redeem: async (admissionId, expectedSignature, currentMs) => {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(expectedSignature) ||
        !Number.isSafeInteger(currentMs)
      ) {
        return 'mismatch'
      }
      try {
        const raw = await redis.eval(
          REDEEM_SCRIPT,
          1,
          grantKey(admissionId),
          expectedSignature,
          currentMs,
          60_000,
        )
        if (!Array.isArray(raw) || raw.length !== 2) return 'unknown'
        const outcome = Number(raw[0])
        if (outcome === -3) return 'expired'
        if (outcome === -2) return 'replayed'
        if (outcome === -1) return 'mismatch'
        if (outcome !== 1) return 'unknown'
        return parseRecord(raw[1]) ?? 'unknown'
      } catch {
        return 'unknown'
      }
    },
    complete: async (admissionId) => {
      try {
        const raw = await redis.eval(COMPLETE_SCRIPT, 1, grantKey(admissionId))
        return parseRecord(raw)
      } catch {
        return null
      }
    },
  })
}
