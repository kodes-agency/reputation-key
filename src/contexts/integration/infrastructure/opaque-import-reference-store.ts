import { randomBytes } from 'node:crypto'
import { z } from 'zod/v4'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  ProviderAuthorizationLeaseRejection,
  ProviderAuthorizationLeaseService,
} from '#/shared/provider-ephemeral/authorization-lease'
import {
  canonicalProviderAuthorizationVector,
  createProviderAuthorizationPrincipalBinding,
  providerAuthorizationFenceSha256,
} from '#/shared/provider-ephemeral/authorization-binding'
import type {
  GoogleImportReferenceStore,
  ImportDiscoveryAccount,
  ImportDiscoveryAuthorization,
  ImportDiscoveryCandidate,
  ImportReferenceResult,
} from '../application/ports/google-import-reference-store.port'
import type {
  ImportAccountPageDto,
  ImportCandidatePageDto,
} from '../application/google-import-v2-contract'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
const REFERENCE_TTL_SECONDS = 15 * 60
const INVALIDATION_TTL_SECONDS = 30

const MAX_ACCOUNTS_PER_PAGE = 20
const MAX_CANDIDATES_PER_PAGE = 100
const MAX_CANDIDATE_BYTES = 16 * 1024
const MAX_PAGE_BYTES = 1024 * 1024
const MAX_SCOPE_RECORDS = 2_000
const MAX_SCOPE_BYTES = 20 * 1024 * 1024
const MAX_ORGANIZATION_RECORDS = 10_000
const MAX_ORGANIZATION_BYTES = 100 * 1024 * 1024
const MAX_CURSOR_REDEMPTIONS = 50
const MAX_PUBLICATION_ATTEMPTS = 3
const MAX_CLOCK_SKEW_MS = 60_000
const HANDLE_NONCE = /^[A-Za-z0-9_-]{43}$/
const KEY_VERSION = /^[a-z][a-z0-9_-]{0,31}$/
function isProviderSuffix(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value.includes('/') ||
    value.includes('?') ||
    value.includes('#') ||
    /\s/u.test(value)
  ) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return false
  }
  return true
}
const RECORD_KEY = /^[A-Za-z0-9_-]{43}$/

type ReferenceAudience =
  'account_selection' | 'accounts_cursor' | 'locations_cursor' | 'import_candidate'
type IndexAudience =
  | 'organization_index'
  | 'user_index'
  | 'user_connection_index'
  | 'connection_index'
  | 'property_index'

const REFERENCE_AUDIENCES: readonly ReferenceAudience[] = Object.freeze([
  'account_selection',
  'accounts_cursor',
  'locations_cursor',
  'import_candidate',
])

const authorizationVectorValueSchema = z.union([
  z.string().max(255),
  z.number().int().safe(),
  z.boolean(),
  z.null(),
])
const authorizationVectorSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/),
    authorizationVectorValueSchema,
  )
  .superRefine((value, context) => {
    if (
      Object.keys(value).length > 64 ||
      Buffer.byteLength(JSON.stringify(value)) > 16_384
    ) {
      context.addIssue({
        code: 'custom',
        message: 'authorization vector is outside bounds',
      })
    }
  })
const authorizationSchema = z.object({
  organizationId: z.string().min(1).max(255),
  userId: z.string().min(1).max(255),
  connectionId: z.string().min(1).max(255),
  connectionLifecycleVersion: z.number().int().safe().nonnegative(),
  connectionAccessVersion: z.number().int().safe().nonnegative(),
  credentialGeneration: z.number().int().safe().nonnegative(),
  authorizationVector: authorizationVectorSchema,
})
const recordBaseSchema = authorizationSchema.extend({
  schemaVersion: z.literal(2),
  issuedAtMs: z.number().int().safe().nonnegative(),
  expiresAtMs: z.number().int().safe().positive(),
})
const roleSchema = z.enum([
  'primary_owner',
  'owner',
  'manager',
  'site_manager',
  'unknown',
])
const displayStringSchema = z.string().min(1).max(4_096)
const optionalDisplayStringSchema = z.string().min(1).max(4_096).nullable()
const googleReviewUriSchema = z.url().max(2_048).startsWith('https://')
const providerSuffixSchema = z.string().min(1).max(255).refine(isProviderSuffix)
const profileSchema = z.object({
  name: displayStringSchema,
  address: optionalDisplayStringSchema,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  timezone: z.string().min(1).max(64),
  profileVersion: z.number().int().safe().positive(),
})
const eligibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create') }).strict(),
  z
    .object({
      kind: z.literal('relink'),
      propertyId: z.string().min(1).max(255),
      profile: profileSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('already_imported'),
      propertyId: z.string().min(1).max(255),
    })
    .strict(),
  z.object({ kind: z.literal('active_binding_conflict') }).strict(),
  z.object({ kind: z.literal('unavailable') }).strict(),
])
const accountRecordSchema = recordBaseSchema
  .extend({
    audience: z.literal('account_selection'),
    accountId: providerSuffixSchema,
    displayName: z.string().min(1).max(1_024),
    role: roleSchema,
    endpoint: z.literal('account-management.accounts.list'),
  })
  .strict()
const accountsCursorRecordSchema = recordBaseSchema
  .extend({
    audience: z.literal('accounts_cursor'),
    pageToken: z.string().min(1).max(2_048),
    remainingRedemptions: z.number().int().min(0).max(MAX_CURSOR_REDEMPTIONS),
  })
  .strict()
const locationsCursorRecordSchema = recordBaseSchema
  .extend({
    audience: z.literal('locations_cursor'),
    accountRef: z.string().min(1).max(80),
    accountId: providerSuffixSchema,
    accountDisplayName: z.string().min(1).max(1_024),
    pageToken: z.string().min(1).max(2_048),
    remainingRedemptions: z.number().int().min(0).max(MAX_CURSOR_REDEMPTIONS),
  })
  .strict()
const candidateRecordSchema = recordBaseSchema
  .extend({
    audience: z.literal('import_candidate'),
    candidateId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    accountRef: z.string().min(1).max(80),
    accountId: providerSuffixSchema,
    locationId: providerSuffixSchema,
    accountDisplayName: z.string().min(1).max(1_024),
    businessName: displayStringSchema,
    address: optionalDisplayStringSchema,
    primaryCategory: optionalDisplayStringSchema,
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    googleReviewUri: googleReviewUriSchema.nullable().default(null),
    eligibility: eligibilitySchema,
    expectedSourceEpoch: z.number().int().safe().nonnegative().nullable(),
    expectedProfileVersion: z.number().int().safe().positive().nullable(),
    affectedPropertyId: z.string().min(1).max(255).nullable(),
  })
  .strict()
const referenceRecordSchema = z.discriminatedUnion('audience', [
  accountRecordSchema,
  accountsCursorRecordSchema,
  locationsCursorRecordSchema,
  candidateRecordSchema,
])
type ReferenceRecord = z.infer<typeof referenceRecordSchema>
type AccountRecord = z.infer<typeof accountRecordSchema>
type AccountsCursorRecord = z.infer<typeof accountsCursorRecordSchema>
type LocationsCursorRecord = z.infer<typeof locationsCursorRecordSchema>
type CandidateRecord = z.infer<typeof candidateRecordSchema>
const candidateClaimSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateRef: z.string().min(1).max(80),
    organizationId: z.string().min(1).max(255),
    userId: z.string().min(1).max(255),
    requestId: z.uuid(),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
type CandidateClaim = z.infer<typeof candidateClaimSchema>

const indexEntrySchema = z
  .object({
    key: z.string().regex(RECORD_KEY),
    bytes: z.number().int().safe().positive().max(MAX_PAGE_BYTES),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
const indexRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    audience: z.enum([
      'organization_index',
      'user_index',
      'user_connection_index',
      'connection_index',
      'property_index',
    ]),
    invalidated: z.boolean().optional(),
    entries: z.array(indexEntrySchema).max(MAX_ORGANIZATION_RECORDS),
  })
  .strict()
type IndexRecord = z.infer<typeof indexRecordSchema>

type EncodedRecord = Readonly<{
  id: string
  handle: string
  key: string
  encoded: string
  bytes: number
  expiresAtMs: number
}>

type AccountPagePublication = Readonly<{
  authorization: ImportDiscoveryAuthorization
  accounts: readonly ImportDiscoveryAccount[]
  nextPageToken: string | null
  contentDeadlineMs: number
  cursorRedemptionBudget?: number
}>

type CandidatePagePublication = Readonly<{
  authorization: ImportDiscoveryAuthorization
  account: Readonly<{
    accountRef: string
    accountId: string
    displayName: string
  }>
  candidates: readonly ImportDiscoveryCandidate[]
  nextPageToken: string | null
  contentDeadlineMs: number
  cursorRedemptionBudget?: number
}>

function leaseFailureCode(
  code: ProviderAuthorizationLeaseRejection,
): ImportReferenceResult<never> {
  if (code === 'malformed') return { ok: false, code: 'malformed' }
  if (code === 'not_found') return { ok: false, code: 'not_found' }
  if (code === 'expired') return { ok: false, code: 'expired' }
  if (
    code === 'principal_mismatch' ||
    code === 'authorization_denied' ||
    code === 'authorization_changed'
  ) {
    return { ok: false, code: 'binding_mismatch' }
  }
  return { ok: false, code: 'runtime_unavailable' }
}

function sameAuthorization(
  actual: ImportDiscoveryAuthorization,
  expected: ImportDiscoveryAuthorization,
): boolean {
  return (
    actual.organizationId === expected.organizationId &&
    actual.userId === expected.userId &&
    actual.connectionId === expected.connectionId &&
    actual.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
    actual.connectionAccessVersion === expected.connectionAccessVersion &&
    actual.credentialGeneration === expected.credentialGeneration &&
    canonicalProviderAuthorizationVector(actual.authorizationVector) ===
      canonicalProviderAuthorizationVector(expected.authorizationVector)
  )
}

function parseEncoded<T extends ReferenceRecord>(
  encoded: string,
  schema: z.ZodType<T>,
): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(encoded))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function parseIndex(
  encoded: string | undefined,
  audience: IndexAudience,
): IndexRecord | null {
  if (!encoded) return null
  try {
    const parsed = indexRecordSchema.safeParse(JSON.parse(encoded))
    return parsed.success && parsed.data.audience === audience ? parsed.data : null
  } catch {
    return null
  }
}

function ttlSecondsUntil(nowMs: number, expiresAtMs: number): number {
  return Math.min(REFERENCE_TTL_SECONDS, Math.floor((expiresAtMs - nowMs) / 1_000))
}

function validPublicationWindow(nowMs: number, contentDeadlineMs: number): boolean {
  const ttl = ttlSecondsUntil(nowMs, contentDeadlineMs)
  return ttl >= 1 && ttl <= REFERENCE_TTL_SECONDS
}

function cursorBudget(value: number | undefined): number | null {
  const budget = value ?? MAX_CURSOR_REDEMPTIONS
  return Number.isInteger(budget) && budget >= 1 && budget <= MAX_CURSOR_REDEMPTIONS
    ? budget
    : null
}

export const createOpaqueImportReferenceStore = (
  deps: Readonly<{
    store: ProviderEphemeralStore
    handleKeys: VersionedHmacKeyring
    leasePrincipalKeys: VersionedHmacKeyring
    leases: ProviderAuthorizationLeaseService
    random?: (bytes: number) => Buffer
    nowMs?: () => number
  }>,
): GoogleImportReferenceStore => {
  const random = deps.random ?? randomBytes
  const nowMs = deps.nowMs ?? Date.now
  const keyVersions = Object.freeze([
    deps.handleKeys.activeVersion,
    ...deps.handleKeys.retainedVersions,
  ])

  const leaseBinding = (authorization: ImportDiscoveryAuthorization) => ({
    ...createProviderAuthorizationPrincipalBinding({
      keys: deps.leasePrincipalKeys,
      audience: 'google-import-authorization-lease-principal-v1',
      organizationId: authorization.organizationId,
      userId: authorization.userId,
      connectionId: authorization.connectionId,
    }),
    authorizationFenceSha256: providerAuthorizationFenceSha256(authorization),
  })

  const issueLease = (
    authorization: ImportDiscoveryAuthorization,
    absoluteDeadlineMs: number,
    atMs: number,
  ) =>
    deps.leases.issue({
      audience: 'import',
      capability: 'property.import_gbp_v2',
      organizationId: authorization.organizationId,
      initiatorUserId: authorization.userId,
      propertyId: null,
      connectionId: authorization.connectionId,
      ...leaseBinding(authorization),
      absoluteDeadlineMs,
      nowMs: atMs,
    })
  const issueHandle = (): string | null => {
    const nonce = random(32)
    if (!Buffer.isBuffer(nonce) || nonce.byteLength !== 32) return null
    return `${deps.handleKeys.activeVersion}.${nonce.toString('base64url')}`
  }

  const recordKey = (audience: ReferenceAudience, handle: string): string | null => {
    const [version, nonce, extra] = handle.split('.')
    if (
      extra !== undefined ||
      !version ||
      !nonce ||
      !KEY_VERSION.test(version) ||
      !HANDLE_NONCE.test(nonce) ||
      !keyVersions.includes(version)
    ) {
      return null
    }
    return deps.handleKeys.derive(`google-import-reference:${audience}`, handle, version)
  }
  const claimKey = (candidateRef: string): string | null => {
    const referenceKey = recordKey('import_candidate', candidateRef)
    if (!referenceKey) return null
    return deps.handleKeys.derive(
      'google-import-reference:import-candidate-claim:v1',
      candidateRef,
      deps.handleKeys.activeVersion,
    )
  }

  const indexKey = (audience: IndexAudience, scope: string, keyVersion: string): string =>
    deps.handleKeys.derive(
      `google-import-reference-index:${audience}`,
      scope,
      keyVersion,
    )!

  const indexLocations = (
    authorization: Pick<
      ImportDiscoveryAuthorization,
      'organizationId' | 'userId' | 'connectionId'
    >,
    keyVersion: string,
  ) => ({
    organization: indexKey(
      'organization_index',
      authorization.organizationId,
      keyVersion,
    ),
    user: indexKey(
      'user_index',
      `${authorization.organizationId}\0${authorization.userId}`,
      keyVersion,
    ),
    userConnection: indexKey(
      'user_connection_index',
      `${authorization.organizationId}\0${authorization.userId}\0${authorization.connectionId}`,
      keyVersion,
    ),
    connection: indexKey(
      'connection_index',
      `${authorization.organizationId}\0${authorization.connectionId}`,
      keyVersion,
    ),
  })

  const encodeRecord = (
    id: string,
    audience: ReferenceAudience,
    record: ReferenceRecord,
  ): EncodedRecord | null => {
    const handle = issueHandle()
    if (!handle) return null
    const key = recordKey(audience, handle)
    if (!key) return null
    const parsed = referenceRecordSchema.safeParse(record)
    if (!parsed.success || parsed.data.audience !== audience) return null
    const encoded = JSON.stringify(parsed.data)
    return {
      id,
      handle,
      key,
      encoded,
      bytes: Buffer.byteLength(encoded),
      expiresAtMs: parsed.data.expiresAtMs,
    }
  }

  const loadIndexes = async (
    authorization: ImportDiscoveryAuthorization,
    atMs: number,
    propertyIds: readonly string[],
  ) => {
    const byVersion = await Promise.all(
      keyVersions.map(async (keyVersion) => {
        const locations = indexLocations(authorization, keyVersion)
        const propertyLocations = propertyIds.map((propertyId) => ({
          propertyId,
          key: indexKey(
            'property_index',
            `${authorization.organizationId}\0${propertyId}`,
            keyVersion,
          ),
        }))
        const [
          organizationEncoded,
          userEncoded,
          userConnectionEncoded,
          connectionEncoded,
          ...propertyEncoded
        ] = await Promise.all([
          deps.store.read('opaque-reference', locations.organization),
          deps.store.read('opaque-reference', locations.user),
          deps.store.read('opaque-reference', locations.userConnection),
          deps.store.read('opaque-reference', locations.connection),
          ...propertyLocations.map((location) =>
            deps.store.read('opaque-reference', location.key),
          ),
        ])
        return {
          keyVersion,
          locations,
          organizationEncoded,
          userEncoded,
          userConnectionEncoded,
          connectionEncoded,
          organization: parseIndex(organizationEncoded, 'organization_index'),
          user: parseIndex(userEncoded, 'user_index'),
          userConnection: parseIndex(userConnectionEncoded, 'user_connection_index'),
          connection: parseIndex(connectionEncoded, 'connection_index'),
          properties: propertyLocations.map((location, index) => ({
            ...location,
            encoded: propertyEncoded[index],
            record: parseIndex(propertyEncoded[index], 'property_index'),
          })),
        }
      }),
    )
    const prune = (record: IndexRecord | null) =>
      record?.entries.filter((entry) => entry.expiresAtMs > atMs) ?? []
    return byVersion.map((item) => ({
      ...item,
      liveOrganization: prune(item.organization),
      liveUser: prune(item.user),
      liveUserConnection: prune(item.userConnection),
      liveConnection: prune(item.connection),
      properties: item.properties.map((property) => ({
        ...property,
        liveEntries: prune(property.record),
      })),
    }))
  }
  const publish = async <T>(
    input: Readonly<{
      authorization: ImportDiscoveryAuthorization
      contentDeadlineMs: number
      propertyIds?: readonly string[]
      createRecords: (
        atMs: number,
        expiresAtMs: number,
        lease: ProviderContentLeaseDto,
      ) => Readonly<{ records: readonly EncodedRecord[]; value: T }> | null
    }>,
  ): Promise<ImportReferenceResult<{ value: T }>> => {
    const authorizationParsed = authorizationSchema.safeParse(input.authorization)
    const atMs = nowMs()
    if (
      !authorizationParsed.success ||
      !validPublicationWindow(atMs, input.contentDeadlineMs)
    ) {
      return { ok: false, code: 'capacity_exceeded' }
    }
    const ttlSeconds = ttlSecondsUntil(atMs, input.contentDeadlineMs)
    const expiresAtMs = atMs + ttlSeconds * 1_000
    const issuedLease = await issueLease(authorizationParsed.data, expiresAtMs, atMs)
    if (!issuedLease.ok) return leaseFailureCode(issuedLease.code)
    let committed = false

    try {
      for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
        const created = input.createRecords(atMs, expiresAtMs, issuedLease.lease)
        if (!created) {
          return { ok: false, code: 'runtime_unavailable' }
        }
        if (
          new Set(created.records.map((record) => record.key)).size !==
          created.records.length
        ) {
          return { ok: false, code: 'runtime_unavailable' }
        }
        const pageBytes = created.records.reduce(
          (total, record) => total + record.bytes,
          0,
        )
        if (pageBytes > MAX_PAGE_BYTES) {
          return { ok: false, code: 'capacity_exceeded' }
        }
        const propertyIds = [...new Set(input.propertyIds ?? [])]
        if (
          propertyIds.length > MAX_CANDIDATES_PER_PAGE ||
          propertyIds.some(
            (propertyId) => propertyId.length < 1 || propertyId.length > 255,
          )
        ) {
          return { ok: false, code: 'capacity_exceeded' }
        }
        const indexes = await loadIndexes(authorizationParsed.data, atMs, propertyIds)
        const active = indexes.find(
          (item) => item.keyVersion === deps.handleKeys.activeVersion,
        )!
        if (
          active.organization?.invalidated === true ||
          active.user?.invalidated === true ||
          active.userConnection?.invalidated === true ||
          active.connection?.invalidated === true ||
          active.properties.some((property) => property.record?.invalidated === true) ||
          (active.organizationEncoded && !active.organization) ||
          (active.userEncoded && !active.user) ||
          (active.userConnectionEncoded && !active.userConnection) ||
          (active.connectionEncoded && !active.connection) ||
          active.properties.some((property) => property.encoded && !property.record)
        ) {
          return { ok: false, code: 'binding_mismatch' }
        }
        const scopeEntries = indexes.flatMap((item) => item.liveUserConnection)
        const organizationEntries = indexes.flatMap((item) => item.liveOrganization)
        const scopeBytes = scopeEntries.reduce((total, entry) => total + entry.bytes, 0)
        const organizationBytes = organizationEntries.reduce(
          (total, entry) => total + entry.bytes,
          0,
        )
        if (
          scopeEntries.length + created.records.length > MAX_SCOPE_RECORDS ||
          scopeBytes + pageBytes > MAX_SCOPE_BYTES ||
          organizationEntries.length + created.records.length >
            MAX_ORGANIZATION_RECORDS ||
          organizationBytes + pageBytes > MAX_ORGANIZATION_BYTES
        ) {
          return { ok: false, code: 'capacity_exceeded' }
        }
        const additions = created.records.map(({ key, bytes, expiresAtMs: expiry }) => ({
          key,
          bytes,
          expiresAtMs: expiry,
        }))
        const nextIndexes = [
          {
            key: active.locations.organization,
            expectedValue: active.organizationEncoded ?? null,
            audience: 'organization_index' as const,
            entries: [...active.liveOrganization, ...additions],
          },
          {
            key: active.locations.user,
            expectedValue: active.userEncoded ?? null,
            audience: 'user_index' as const,
            entries: [...active.liveUser, ...additions],
          },
          {
            key: active.locations.userConnection,
            expectedValue: active.userConnectionEncoded ?? null,
            audience: 'user_connection_index' as const,
            entries: [...active.liveUserConnection, ...additions],
          },
          {
            key: active.locations.connection,
            expectedValue: active.connectionEncoded ?? null,
            audience: 'connection_index' as const,
            entries: [...active.liveConnection, ...additions],
          },
          ...active.properties.map((property) => ({
            key: property.key,
            expectedValue: property.encoded ?? null,
            audience: 'property_index' as const,
            entries: [...property.liveEntries, ...additions],
          })),
        ]
        const applied = await deps.store.compareAndSwapMany('opaque-reference', [
          ...created.records.map((record) => ({
            key: record.key,
            expectedValue: null,
            next: { value: record.encoded, ttlSeconds },
          })),
          ...nextIndexes.map((index) => ({
            key: index.key,
            expectedValue: index.expectedValue,
            next: {
              value: JSON.stringify({
                schemaVersion: 1,
                audience: index.audience,
                entries: index.entries,
              }),
              ttlSeconds,
            },
          })),
        ])
        if (applied) {
          committed = true
          return { ok: true, value: created.value }
        }
      }
      return { ok: false, code: 'runtime_unavailable' }
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    } finally {
      if (!committed) {
        await deps.leases.invalidate(issuedLease.lease.leaseRef).catch(() => {})
      }
    }
  }

  const findWrongAudience = async (handle: string, expected: ReferenceAudience) => {
    for (const audience of REFERENCE_AUDIENCES) {
      if (audience === expected) continue
      const key = recordKey(audience, handle)
      if (key && (await deps.store.read('opaque-reference', key)) !== undefined)
        return true
    }
    return false
  }
  const invalidationScopes = (
    record: ReferenceRecord,
  ): readonly Readonly<{ audience: IndexAudience; scope: string }>[] => {
    const scopes: Readonly<{ audience: IndexAudience; scope: string }>[] = [
      { audience: 'organization_index', scope: record.organizationId },
      {
        audience: 'user_index',
        scope: `${record.organizationId}\0${record.userId}`,
      },
      {
        audience: 'user_connection_index',
        scope: `${record.organizationId}\0${record.userId}\0${record.connectionId}`,
      },
      {
        audience: 'connection_index',
        scope: `${record.organizationId}\0${record.connectionId}`,
      },
    ]
    if (record.audience === 'import_candidate') {
      const propertyId =
        record.eligibility.kind === 'relink' ||
        record.eligibility.kind === 'already_imported'
          ? record.eligibility.propertyId
          : record.affectedPropertyId
      if (propertyId) {
        scopes.push({
          audience: 'property_index',
          scope: `${record.organizationId}\0${propertyId}`,
        })
      }
    }
    return scopes
  }

  const isInvalidated = async (record: ReferenceRecord): Promise<boolean | null> => {
    try {
      for (const keyVersion of keyVersions) {
        for (const scope of invalidationScopes(record)) {
          const encoded = await deps.store.read(
            'opaque-reference',
            indexKey(scope.audience, scope.scope, keyVersion),
          )
          if (!encoded) continue
          const index = parseIndex(encoded, scope.audience)
          if (!index) return null
          if (index.invalidated === true) return true
        }
      }
      return false
    } catch {
      return null
    }
  }

  const invalidateIndex = async (
    audience: IndexAudience,
    scope: string,
  ): Promise<boolean> => {
    if (scope.length < 1 || scope.length > 767) return false
    try {
      for (const keyVersion of keyVersions) {
        const key = indexKey(audience, scope, keyVersion)
        for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
          const encoded = await deps.store.read('opaque-reference', key)
          if (!encoded) break
          const index = parseIndex(encoded, audience)
          if (!index) return false
          const tombstoned = await deps.store.replaceIfEquals(
            'opaque-reference',
            key,
            encoded,
            JSON.stringify({
              schemaVersion: 1,
              audience,
              entries: [],
              invalidated: true,
            }),
            INVALIDATION_TTL_SECONDS,
          )
          if (tombstoned === 'mismatch') continue
          if (tombstoned === 'not_found') break
          for (const entry of index.entries) {
            await deps.store.remove('opaque-reference', entry.key)
          }
          break
        }
      }
      return true
    } catch {
      return false
    }
  }

  const loadRecord = async <T extends ReferenceRecord>(
    input: Readonly<{
      handle: string
      audience: ReferenceAudience
      authorization: ImportDiscoveryAuthorization
      schema: z.ZodType<T>
    }>,
  ): Promise<ImportReferenceResult<{ record: T; key: string; encoded: string }>> => {
    const key = recordKey(input.audience, input.handle)
    if (!key) return { ok: false, code: 'malformed' }
    try {
      const encoded = await deps.store.read('opaque-reference', key)
      if (!encoded) {
        return (await findWrongAudience(input.handle, input.audience))
          ? { ok: false, code: 'binding_mismatch' }
          : { ok: false, code: 'not_found' }
      }
      const record = parseEncoded(encoded, input.schema)
      if (!record) return { ok: false, code: 'malformed' }
      const atMs = nowMs()
      if (record.expiresAtMs <= atMs || record.issuedAtMs > atMs + MAX_CLOCK_SKEW_MS) {
        await deps.store.consumeIfEquals('opaque-reference', key, encoded)
        return { ok: false, code: 'expired' }
      }
      if (!sameAuthorization(record, input.authorization)) {
        return { ok: false, code: 'binding_mismatch' }
      }
      const invalidated = await isInvalidated(record)
      if (invalidated === null) {
        return { ok: false, code: 'runtime_unavailable' }
      }
      if (invalidated) {
        return { ok: false, code: 'not_found' }
      }
      return { ok: true, record, key, encoded }
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
  }

  const redeemCursor = async <T extends AccountsCursorRecord | LocationsCursorRecord>(
    input: Readonly<{
      handle: string
      audience: 'accounts_cursor' | 'locations_cursor'
      authorization: ImportDiscoveryAuthorization
      schema: z.ZodType<T>
    }>,
  ): Promise<ImportReferenceResult<{ record: T }>> => {
    for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
      const loaded = await loadRecord(input)
      if (!loaded.ok) return loaded
      if (loaded.record.remainingRedemptions === 0) {
        return { ok: false, code: 'budget_exhausted' }
      }
      const next = {
        ...loaded.record,
        remainingRedemptions: loaded.record.remainingRedemptions - 1,
      }
      const ttlSeconds = ttlSecondsUntil(nowMs(), loaded.record.expiresAtMs)
      if (ttlSeconds < 1) return { ok: false, code: 'expired' }
      try {
        const replaced = await deps.store.replaceIfEquals(
          'opaque-reference',
          loaded.key,
          loaded.encoded,
          JSON.stringify(next),
          ttlSeconds,
        )
        if (replaced === 'replaced') return { ok: true, record: loaded.record }
        if (replaced === 'not_found') return { ok: false, code: 'not_found' }
      } catch {
        return { ok: false, code: 'runtime_unavailable' }
      }
    }
    return { ok: false, code: 'runtime_unavailable' }
  }

  return Object.freeze({
    publishAccountPage: async (
      input: AccountPagePublication,
    ): Promise<ImportReferenceResult<{ value: ImportAccountPageDto }>> => {
      const budget = cursorBudget(input.cursorRedemptionBudget)
      if (
        input.accounts.length > MAX_ACCOUNTS_PER_PAGE ||
        budget === null ||
        input.accounts.some(
          (account) =>
            !isProviderSuffix(account.accountId) ||
            account.displayName.length < 1 ||
            account.displayName.length > 1_024 ||
            !roleSchema.safeParse(account.role).success,
        ) ||
        (input.nextPageToken !== null &&
          (input.nextPageToken.length < 1 || input.nextPageToken.length > 2_048))
      ) {
        return { ok: false, code: 'capacity_exceeded' }
      }
      return publish({
        authorization: input.authorization,
        contentDeadlineMs: input.contentDeadlineMs,
        createRecords: (atMs, expiresAtMs, lease) => {
          const accountRecords = input.accounts.map((account, index) =>
            encodeRecord(`account:${index}`, 'account_selection', {
              schemaVersion: 2,
              audience: 'account_selection',
              ...input.authorization,
              issuedAtMs: atMs,
              expiresAtMs,
              ...account,
              endpoint: 'account-management.accounts.list',
            }),
          )
          if (accountRecords.some((record) => record === null)) return null
          const cursor = input.nextPageToken
            ? encodeRecord('cursor', 'accounts_cursor', {
                schemaVersion: 2,
                audience: 'accounts_cursor',
                ...input.authorization,
                issuedAtMs: atMs,
                expiresAtMs,
                pageToken: input.nextPageToken,
                remainingRedemptions: budget,
              })
            : null
          if (input.nextPageToken && !cursor) return null
          const records = [
            ...(accountRecords as EncodedRecord[]),
            ...(cursor ? [cursor] : []),
          ]
          const byId = new Map(records.map((record) => [record.id, record]))
          const value: ImportAccountPageDto = Object.freeze({
            items: Object.freeze(
              input.accounts.map((account, index) =>
                Object.freeze({
                  accountRef: byId.get(`account:${index}`)!.handle,
                  displayName: account.displayName,
                  role: account.role,
                }),
              ),
            ),
            nextCursor: cursor?.handle ?? null,
            contentExpiresAt: new Date(expiresAtMs).toISOString(),
            authorizationLease: lease,
            contentTtlSeconds: ttlSecondsUntil(atMs, expiresAtMs),
          })
          if (Buffer.byteLength(JSON.stringify(value)) > MAX_PAGE_BYTES) return null
          return { records, value }
        },
      })
    },

    resolveAccount: async (
      input: Readonly<{
        accountRef: string
        authorization: ImportDiscoveryAuthorization
      }>,
    ): Promise<
      ImportReferenceResult<{
        accountId: string
        displayName: string
        role: AccountRecord['role']
      }>
    > => {
      const loaded = await loadRecord({
        handle: input.accountRef,
        audience: 'account_selection',
        authorization: input.authorization,
        schema: accountRecordSchema,
      })
      return loaded.ok
        ? {
            ok: true,
            accountId: loaded.record.accountId,
            displayName: loaded.record.displayName,
            role: loaded.record.role,
          }
        : loaded
    },

    redeemAccountsCursor: async (
      input: Readonly<{
        cursorRef: string
        authorization: ImportDiscoveryAuthorization
      }>,
    ): Promise<ImportReferenceResult<{ pageToken: string }>> => {
      const redeemed = await redeemCursor({
        handle: input.cursorRef,
        audience: 'accounts_cursor',
        authorization: input.authorization,
        schema: accountsCursorRecordSchema,
      })
      return redeemed.ok ? { ok: true, pageToken: redeemed.record.pageToken } : redeemed
    },

    publishCandidatePage: async (
      input: CandidatePagePublication,
    ): Promise<ImportReferenceResult<{ value: ImportCandidatePageDto }>> => {
      const budget = cursorBudget(input.cursorRedemptionBudget)
      const candidatesAreBounded = input.candidates.every((candidate) => {
        const parsed = candidateRecordSchema.safeParse({
          schemaVersion: 2,
          audience: 'import_candidate',
          ...input.authorization,
          issuedAtMs: 0,
          expiresAtMs: 1,
          candidateId: 'A'.repeat(22),
          accountRef: input.account.accountRef,
          ...candidate,
          expectedSourceEpoch: candidate.expectedSourceEpoch ?? null,
          expectedProfileVersion: candidate.expectedProfileVersion ?? null,
          affectedPropertyId: candidate.affectedPropertyId ?? null,
        })
        return (
          parsed.success &&
          Buffer.byteLength(JSON.stringify(parsed.data)) <= MAX_CANDIDATE_BYTES
        )
      })
      if (
        input.candidates.length > MAX_CANDIDATES_PER_PAGE ||
        !candidatesAreBounded ||
        budget === null ||
        !recordKey('account_selection', input.account.accountRef) ||
        !isProviderSuffix(input.account.accountId) ||
        input.account.displayName.length < 1 ||
        input.account.displayName.length > 1_024 ||
        (input.nextPageToken !== null &&
          (input.nextPageToken.length < 1 || input.nextPageToken.length > 2_048))
      ) {
        return { ok: false, code: 'capacity_exceeded' }
      }
      return publish({
        authorization: input.authorization,
        contentDeadlineMs: input.contentDeadlineMs,
        propertyIds: input.candidates.flatMap((candidate) => {
          if (
            candidate.eligibility.kind === 'relink' ||
            candidate.eligibility.kind === 'already_imported'
          ) {
            return [candidate.eligibility.propertyId]
          }
          return candidate.affectedPropertyId ? [candidate.affectedPropertyId] : []
        }),
        createRecords: (atMs, expiresAtMs, lease) => {
          const dtoItems: ImportCandidatePageDto['items'][number][] = []
          const records: EncodedRecord[] = []
          for (const [index, candidate] of input.candidates.entries()) {
            const candidateIdBytes = random(16)
            if (
              !Buffer.isBuffer(candidateIdBytes) ||
              candidateIdBytes.byteLength !== 16
            ) {
              return null
            }
            const candidateId = candidateIdBytes.toString('base64url')
            const actionable =
              candidate.eligibility.kind === 'create' ||
              candidate.eligibility.kind === 'relink'
            const parsedCandidate = candidateRecordSchema.safeParse({
              schemaVersion: 2,
              audience: 'import_candidate',
              ...input.authorization,
              issuedAtMs: atMs,
              expiresAtMs,
              candidateId,
              accountRef: input.account.accountRef,
              ...candidate,
              expectedSourceEpoch: candidate.expectedSourceEpoch ?? null,
              expectedProfileVersion: candidate.expectedProfileVersion ?? null,
              affectedPropertyId: candidate.affectedPropertyId ?? null,
            })
            if (!parsedCandidate.success) return null
            let candidateRef: string | null = null
            if (actionable) {
              const encoded = encodeRecord(
                `candidate:${index}`,
                'import_candidate',
                parsedCandidate.data,
              )
              if (!encoded || encoded.bytes > MAX_CANDIDATE_BYTES) return null
              records.push(encoded)
              candidateRef = encoded.handle
            }
            dtoItems.push(
              Object.freeze({
                candidateId,
                candidateRef,
                accountRef: input.account.accountRef,
                accountDisplayName: candidate.accountDisplayName,
                businessName: candidate.businessName,
                address: candidate.address,
                primaryCategory: candidate.primaryCategory,
                countryCode: candidate.countryCode,
                eligibility: candidate.eligibility,
              }),
            )
          }
          const cursor = input.nextPageToken
            ? encodeRecord('cursor', 'locations_cursor', {
                schemaVersion: 2,
                audience: 'locations_cursor',
                ...input.authorization,
                issuedAtMs: atMs,
                expiresAtMs,
                accountRef: input.account.accountRef,
                accountId: input.account.accountId,
                accountDisplayName: input.account.displayName,
                pageToken: input.nextPageToken,
                remainingRedemptions: budget,
              })
            : null
          if (input.nextPageToken && !cursor) return null
          records.push(...(cursor ? [cursor] : []))
          const value: ImportCandidatePageDto = Object.freeze({
            items: Object.freeze(dtoItems),
            nextCursor: cursor?.handle ?? null,
            contentExpiresAt: new Date(expiresAtMs).toISOString(),
            authorizationLease: lease,
            contentTtlSeconds: ttlSecondsUntil(atMs, expiresAtMs),
          })
          if (Buffer.byteLength(JSON.stringify(value)) > MAX_PAGE_BYTES) {
            return null
          }
          return { records, value }
        },
      })
    },

    redeemLocationsCursor: async (
      input: Readonly<{
        cursorRef: string
        authorization: ImportDiscoveryAuthorization
      }>,
    ): Promise<
      ImportReferenceResult<{
        accountRef: string
        accountId: string
        accountDisplayName: string
        pageToken: string
      }>
    > => {
      const redeemed = await redeemCursor({
        handle: input.cursorRef,
        audience: 'locations_cursor',
        authorization: input.authorization,
        schema: locationsCursorRecordSchema,
      })
      return redeemed.ok
        ? {
            ok: true,
            accountRef: redeemed.record.accountRef,
            accountId: redeemed.record.accountId,
            accountDisplayName: redeemed.record.accountDisplayName,
            pageToken: redeemed.record.pageToken,
          }
        : redeemed
    },

    claimCandidates: async (
      input: Readonly<{
        candidateRefs: readonly string[]
        organizationId: string
        userId: string
        requestId: string
      }>,
    ) => {
      if (
        input.candidateRefs.length < 1 ||
        input.candidateRefs.length > MAX_CANDIDATES_PER_PAGE ||
        new Set(input.candidateRefs).size !== input.candidateRefs.length
      ) {
        return { ok: false as const, code: 'malformed' as const }
      }
      try {
        const loaded = await Promise.all(
          input.candidateRefs.map(async (candidateRef) => {
            const key = recordKey('import_candidate', candidateRef)
            const candidateClaimKey = claimKey(candidateRef)
            if (!key || !candidateClaimKey) return null
            const encoded = await deps.store.read('opaque-reference', key)
            const record = encoded ? parseEncoded(encoded, candidateRecordSchema) : null
            const atMs = nowMs()
            if (
              !record ||
              record.expiresAtMs <= atMs ||
              record.issuedAtMs > atMs + MAX_CLOCK_SKEW_MS
            ) {
              return null
            }
            const invalidated = await isInvalidated(record)
            if (
              invalidated !== false ||
              record.organizationId !== input.organizationId ||
              record.userId !== input.userId
            ) {
              return null
            }
            const existingClaimEncoded = await deps.store.read(
              'opaque-reference',
              candidateClaimKey,
            )
            const existingClaim = existingClaimEncoded
              ? candidateClaimSchema.safeParse(JSON.parse(existingClaimEncoded))
              : null
            if (existingClaimEncoded && !existingClaim?.success) return null
            if (
              existingClaim?.success &&
              (existingClaim.data.candidateRef !== candidateRef ||
                existingClaim.data.organizationId !== input.organizationId ||
                existingClaim.data.userId !== input.userId ||
                existingClaim.data.requestId !== input.requestId)
            ) {
              return null
            }
            const claim = JSON.stringify({
              schemaVersion: 1,
              candidateRef,
              organizationId: input.organizationId,
              userId: input.userId,
              requestId: input.requestId,
              expiresAtMs: record.expiresAtMs,
            } satisfies CandidateClaim)
            return {
              candidateRef,
              record,
              candidateClaimKey,
              existingClaimEncoded: existingClaimEncoded ?? null,
              claim,
              ttlSeconds: ttlSecondsUntil(atMs, record.expiresAtMs),
            }
          }),
        )
        if (loaded.some((entry) => entry === null || entry.ttlSeconds < 1)) {
          return { ok: false as const, code: 'binding_mismatch' as const }
        }
        const records = loaded.filter((entry) => entry !== null)
        const applied = await deps.store.compareAndSwapMany(
          'opaque-reference',
          records.map((entry) => ({
            key: entry.candidateClaimKey,
            expectedValue: entry.existingClaimEncoded,
            next: {
              value: entry.claim,
              ttlSeconds: entry.ttlSeconds,
            },
          })),
        )
        if (!applied) {
          return { ok: false as const, code: 'binding_mismatch' as const }
        }
        return {
          ok: true as const,
          candidates: records.map((entry) => ({
            candidateRef: entry.candidateRef,
            authorization: {
              organizationId: entry.record.organizationId,
              userId: entry.record.userId,
              connectionId: entry.record.connectionId,
              connectionLifecycleVersion: entry.record.connectionLifecycleVersion,
              connectionAccessVersion: entry.record.connectionAccessVersion,
              credentialGeneration: entry.record.credentialGeneration,
              authorizationVector: entry.record.authorizationVector,
            },
            candidate: entry.record,
          })),
        }
      } catch {
        return { ok: false as const, code: 'runtime_unavailable' as const }
      }
    },

    releaseCandidateClaims: async (
      input: Readonly<{
        candidateRefs: readonly string[]
        organizationId: string
        userId: string
        requestId: string
      }>,
    ): Promise<boolean> => {
      if (
        input.candidateRefs.length < 1 ||
        input.candidateRefs.length > MAX_CANDIDATES_PER_PAGE ||
        new Set(input.candidateRefs).size !== input.candidateRefs.length
      ) {
        return false
      }
      try {
        const claims = await Promise.all(
          input.candidateRefs.map(async (candidateRef) => {
            const key = claimKey(candidateRef)
            if (!key) return null
            const encoded = await deps.store.read('opaque-reference', key)
            if (!encoded) return null
            const parsed = candidateClaimSchema.safeParse(JSON.parse(encoded))
            if (
              !parsed.success ||
              parsed.data.candidateRef !== candidateRef ||
              parsed.data.organizationId !== input.organizationId ||
              parsed.data.userId !== input.userId ||
              parsed.data.requestId !== input.requestId
            ) {
              return null
            }
            return { key, encoded }
          }),
        )
        if (claims.some((claim) => claim === null)) return false
        return deps.store.compareAndSwapMany(
          'opaque-reference',
          claims
            .filter((claim) => claim !== null)
            .map((claim) => ({
              key: claim.key,
              expectedValue: claim.encoded,
              next: null,
            })),
        )
      } catch {
        return false
      }
    },

    consumeCandidateClaims: async (
      input: Readonly<{
        candidateRefs: readonly string[]
        organizationId: string
        userId: string
        requestId: string
      }>,
    ): Promise<boolean> => {
      if (
        input.candidateRefs.length < 1 ||
        input.candidateRefs.length > MAX_CANDIDATES_PER_PAGE ||
        new Set(input.candidateRefs).size !== input.candidateRefs.length
      ) {
        return false
      }
      try {
        const records = await Promise.all(
          input.candidateRefs.map(async (candidateRef) => {
            const candidateKey = recordKey('import_candidate', candidateRef)
            const candidateClaimKey = claimKey(candidateRef)
            if (!candidateKey || !candidateClaimKey) return null
            const [encodedCandidate, encodedClaim] = await Promise.all([
              deps.store.read('opaque-reference', candidateKey),
              deps.store.read('opaque-reference', candidateClaimKey),
            ])
            if (!encodedCandidate || !encodedClaim) return null
            const claim = candidateClaimSchema.safeParse(JSON.parse(encodedClaim))
            if (
              !claim.success ||
              claim.data.candidateRef !== candidateRef ||
              claim.data.organizationId !== input.organizationId ||
              claim.data.userId !== input.userId ||
              claim.data.requestId !== input.requestId
            ) {
              return null
            }
            return {
              candidateKey,
              candidateClaimKey,
              encodedCandidate,
              encodedClaim,
            }
          }),
        )
        if (records.some((record) => record === null)) return false
        return deps.store.compareAndSwapMany(
          'opaque-reference',
          records.flatMap((record) =>
            record
              ? [
                  {
                    key: record.candidateKey,
                    expectedValue: record.encodedCandidate,
                    next: null,
                  },
                  {
                    key: record.candidateClaimKey,
                    expectedValue: record.encodedClaim,
                    next: null,
                  },
                ]
              : [],
          ),
        )
      } catch {
        return false
      }
    },

    resolveCandidate: async (
      input: Readonly<{
        candidateRef: string
        authorization: ImportDiscoveryAuthorization
      }>,
    ): Promise<ImportReferenceResult<{ candidate: CandidateRecord }>> => {
      const loaded = await loadRecord({
        handle: input.candidateRef,
        audience: 'import_candidate',
        authorization: input.authorization,
        schema: candidateRecordSchema,
      })
      return loaded.ok ? { ok: true, candidate: loaded.record } : loaded
    },

    renewLease: async (
      input: Readonly<{
        leaseRef: string
        authorization: ImportDiscoveryAuthorization
      }>,
    ): Promise<ImportReferenceResult<{ lease: ProviderContentLeaseDto }>> => {
      const authorization = authorizationSchema.safeParse(input.authorization)
      if (!authorization.success) return { ok: false, code: 'malformed' }
      const renewed = await deps.leases.renew({
        leaseRef: input.leaseRef,
        ...leaseBinding(authorization.data),
        nowMs: nowMs(),
      })
      return renewed.ok
        ? { ok: true, lease: renewed.lease }
        : leaseFailureCode(renewed.code)
    },

    invalidateOrganization: async (
      input: Readonly<{
        organizationId: string
      }>,
    ): Promise<boolean> => invalidateIndex('organization_index', input.organizationId),

    invalidateUser: async (
      input: Readonly<{
        organizationId: string
        userId: string
      }>,
    ): Promise<boolean> =>
      invalidateIndex('user_index', `${input.organizationId}\0${input.userId}`),

    invalidateConnection: async (
      input: Readonly<{
        organizationId: string
        connectionId: string
      }>,
    ): Promise<boolean> =>
      invalidateIndex(
        'connection_index',
        `${input.organizationId}\0${input.connectionId}`,
      ),

    invalidateProperty: async (
      input: Readonly<{
        organizationId: string
        propertyId: string
      }>,
    ): Promise<boolean> =>
      invalidateIndex('property_index', `${input.organizationId}\0${input.propertyId}`),
  })
}
