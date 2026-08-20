import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  RetryPropertyImportItemInput,
  StartPropertyImportV2Input,
} from './dto/google-import-v2.dto'

const WIRE_AUDIENCE = 'google-import-replay:wire:v1'
const SEMANTIC_AUDIENCE = 'google-import-replay:semantic:v1'
const RETRY_AUDIENCE = 'google-import-replay:retry:v1'

export type GoogleImportReplayDigest = Readonly<{
  keyVersion: string
  digest: string
}>

export type GoogleImportReplayScope = Readonly<{
  organizationId: string
  userId: string
  requestId: string
}>

export type GoogleImportSemanticItem = Readonly<{
  action: 'create' | 'relink'
  connectionId: string
  accountId: string
  locationId: string
  existingPropertyId: string | null
  expectedConnectionLifecycleVersion: number
  expectedConnectionAccessVersion: number
  expectedCredentialGeneration: number
  expectedSourceEpoch: number | null
  expectedProfileVersion: number | null
  profile: Readonly<{
    name: string
    address: string | null
    countryCode: string | null
    timezone: string
    updateExistingProfile: boolean
  }>
}>

export type GoogleImportSemanticRequest = Readonly<{
  requestId: string
  items: readonly GoogleImportSemanticItem[]
}>

type CanonicalPrimitive = string | number | boolean | null
interface CanonicalObject {
  readonly [key: string]: CanonicalValue
}
type CanonicalArray = readonly CanonicalValue[]
type CanonicalValue = CanonicalPrimitive | CanonicalArray | CanonicalObject

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function encode(value: CanonicalValue): string {
  if (value === null) return 'n0:'
  if (typeof value === 'string') return `s${bytes(value)}:${value}`
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new Error('canonical number is not a safe integer')
    const rendered = String(value)
    return `i${bytes(rendered)}:${rendered}`
  }
  if (typeof value === 'boolean') return value ? 'b1:1' : 'b1:0'
  if (Array.isArray(value)) {
    const members = value.map(encode).join('')
    return `a${value.length}:${bytes(members)}:${members}`
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const members = entries
    .map(([key, member]) => `${encode(key)}${encode(member)}`)
    .join('')
  return `o${entries.length}:${bytes(members)}:${members}`
}

function sortedItems<T>(
  items: readonly T[],
  project: (item: T) => CanonicalValue,
): readonly CanonicalValue[] {
  return items
    .map((item) => ({ value: project(item), encoded: encode(project(item)) }))
    .sort((left, right) => left.encoded.localeCompare(right.encoded))
    .map((item) => item.value)
}

export function canonicalizeGoogleImportWireRequest(
  input: StartPropertyImportV2Input,
): string {
  return encode({
    confirmation: input.confirmation,
    items: sortedItems(input.items, (item): CanonicalValue => {
      if (item.action === 'create') {
        return {
          action: item.action,
          candidateRef: item.candidateRef,
          profile: {
            address: item.profile.address,
            confirmed: item.profile.confirmed,
            countryCode: item.profile.countryCode,
            name: item.profile.name,
            timezone: item.profile.timezone,
          },
        } satisfies CanonicalObject
      }
      if (item.profile.updateExistingProfile) {
        return {
          action: item.action,
          candidateRef: item.candidateRef,
          existingPropertyId: item.existingPropertyId,
          profile: {
            address: item.profile.address,
            confirmed: item.profile.confirmed,
            name: item.profile.name,
            timezone: item.profile.timezone,
            updateExistingProfile: true,
          },
        } satisfies CanonicalObject
      }
      return {
        action: item.action,
        candidateRef: item.candidateRef,
        existingPropertyId: item.existingPropertyId,
        profile: {
          confirmed: item.profile.confirmed,
          timezone: item.profile.timezone,
          updateExistingProfile: false,
        },
      } satisfies CanonicalObject
    }),
    requestId: input.requestId,
  })
}

export function canonicalizeGoogleImportRetryRequest(
  input: RetryPropertyImportItemInput,
): string {
  return encode({
    expectedRetryRevision: input.expectedRetryRevision,
    itemId: input.itemId,
    retryRequestId: input.retryRequestId,
  })
}

export function canonicalizeGoogleImportSemanticRequest(
  input: GoogleImportSemanticRequest,
): string {
  return encode({
    items: sortedItems(input.items, (item) => ({
      accountId: item.accountId,
      action: item.action,
      connectionId: item.connectionId,
      existingPropertyId: item.existingPropertyId,
      expectedConnectionAccessVersion: item.expectedConnectionAccessVersion,
      expectedConnectionLifecycleVersion: item.expectedConnectionLifecycleVersion,
      expectedCredentialGeneration: item.expectedCredentialGeneration,
      expectedProfileVersion: item.expectedProfileVersion,
      expectedSourceEpoch: item.expectedSourceEpoch,
      locationId: item.locationId,
      profile: {
        address: item.profile.address,
        countryCode: item.profile.countryCode,
        name: item.profile.name,
        timezone: item.profile.timezone,
        updateExistingProfile: item.profile.updateExistingProfile,
      },
    })),
    requestId: input.requestId,
  })
}

function scoped(scope: GoogleImportReplayScope, canonical: string): string {
  return encode({
    organizationId: scope.organizationId,
    requestId: scope.requestId,
    userId: scope.userId,
    value: canonical,
  })
}

export function createGoogleImportReplayDigests(keys: VersionedHmacKeyring): Readonly<{
  signWire: (
    scope: GoogleImportReplayScope,
    input: StartPropertyImportV2Input,
  ) => GoogleImportReplayDigest
  verifyWire: (
    scope: GoogleImportReplayScope,
    input: StartPropertyImportV2Input,
    stored: GoogleImportReplayDigest,
  ) => boolean
  signSemantic: (
    scope: GoogleImportReplayScope,
    input: GoogleImportSemanticRequest,
  ) => GoogleImportReplayDigest
  verifySemantic: (
    scope: GoogleImportReplayScope,
    input: GoogleImportSemanticRequest,
    stored: GoogleImportReplayDigest,
  ) => boolean
  signRetry: (
    scope: GoogleImportReplayScope,
    input: RetryPropertyImportItemInput,
  ) => GoogleImportReplayDigest
  verifyRetry: (
    scope: GoogleImportReplayScope,
    input: RetryPropertyImportItemInput,
    stored: GoogleImportReplayDigest,
  ) => boolean
}> {
  return Object.freeze({
    signWire: (scope, input) =>
      keys.sign(WIRE_AUDIENCE, scoped(scope, canonicalizeGoogleImportWireRequest(input))),
    verifyWire: (scope, input, stored) =>
      keys.verify(
        WIRE_AUDIENCE,
        scoped(scope, canonicalizeGoogleImportWireRequest(input)),
        stored.keyVersion,
        stored.digest,
      ),
    signSemantic: (scope, input) =>
      keys.sign(
        SEMANTIC_AUDIENCE,
        scoped(scope, canonicalizeGoogleImportSemanticRequest(input)),
      ),
    verifySemantic: (scope, input, stored) =>
      keys.verify(
        SEMANTIC_AUDIENCE,
        scoped(scope, canonicalizeGoogleImportSemanticRequest(input)),
        stored.keyVersion,
        stored.digest,
      ),
    signRetry: (scope, input) =>
      keys.sign(
        RETRY_AUDIENCE,
        scoped(scope, canonicalizeGoogleImportRetryRequest(input)),
      ),
    verifyRetry: (scope, input, stored) =>
      keys.verify(
        RETRY_AUDIENCE,
        scoped(scope, canonicalizeGoogleImportRetryRequest(input)),
        stored.keyVersion,
        stored.digest,
      ),
  })
}
