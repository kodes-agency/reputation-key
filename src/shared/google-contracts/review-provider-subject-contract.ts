import { createHmac, timingSafeEqual } from 'node:crypto'

export const REVIEW_PROVIDER_SUBJECT_CONTRACT_VERSION =
  'review-provider-subject-v1' as const
export const MAX_REVIEW_PROVIDER_RESOURCE_BYTES_V1 = 1_024

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const UUID_SHAPE =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/u
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._~-]{0,254}'
const REVIEW_RESOURCE = new RegExp(
  `^accounts/(${SEGMENT})/locations/(${SEGMENT})/reviews/(${SEGMENT})$`,
  'u',
)
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/u
const encoder = new TextEncoder()
const LOCATOR_DOMAIN = encoder.encode('review-provider-subject-locator-v1\0')
const NON_UUID_ORGANIZATION_DOMAIN = encoder.encode('organization-id\0')
const VERIFIER_DOMAIN = encoder.encode('review-provider-subject-verifier-v1\0')

export type ReviewProviderResource = Readonly<{
  name: string
  accountId: string
  locationId: string
  reviewId: string
}>

export type ReviewProviderSubjectInput = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  resourceName: string
  keyVersion: string
  key: Uint8Array
}>

export type ReviewProviderSubject = Readonly<{
  contractVersion: typeof REVIEW_PROVIDER_SUBJECT_CONTRACT_VERSION
  keyVersion: string
  locatorHmac: Uint8Array
  verifierHmac: Uint8Array
}>

function fail(message: string): never {
  throw new TypeError(
    `Invalid ${REVIEW_PROVIDER_SUBJECT_CONTRACT_VERSION} input: ${message}`,
  )
}

export function parseReviewProviderResource(name: string): ReviewProviderResource {
  if (typeof name !== 'string' || name.length === 0) fail('resourceName is required')
  if (name.length > MAX_REVIEW_PROVIDER_RESOURCE_BYTES_V1) {
    fail('resourceName exceeds the UTF-8 byte limit')
  }
  const match = REVIEW_RESOURCE.exec(name)
  if (!match || encoder.encode(name).byteLength > MAX_REVIEW_PROVIDER_RESOURCE_BYTES_V1) {
    fail('resourceName does not match the canonical Google review grammar')
  }
  return Object.freeze({
    name,
    accountId: match[1]!,
    locationId: match[2]!,
    reviewId: match[3]!,
  })
}

function uuid16(value: string, field: string): Uint8Array {
  if (!CANONICAL_UUID.test(value)) fail(`${field} must be a canonical lowercase UUID`)
  const compact = value.replaceAll('-', '')
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function organizationScopeBytes(value: string): Uint8Array {
  if (CANONICAL_UUID.test(value)) return uuid16(value, 'organizationId')
  if (UUID_SHAPE.test(value)) fail('organizationId must be a canonical lowercase UUID')
  if (!SAFE_SCOPE_ID.test(value)) fail('organizationId must be a safe identifier')
  const identifier = encoder.encode(value)
  const bytes = new Uint8Array(
    NON_UUID_ORGANIZATION_DOMAIN.byteLength + 2 + identifier.byteLength,
  )
  bytes.set(NON_UUID_ORGANIZATION_DOMAIN)
  const view = new DataView(bytes.buffer)
  view.setUint16(NON_UUID_ORGANIZATION_DOMAIN.byteLength, identifier.byteLength, false)
  bytes.set(identifier, NON_UUID_ORGANIZATION_DOMAIN.byteLength + 2)
  return bytes
}

export function encodeReviewProviderSubjectScope(
  input: Readonly<{
    organizationId: string
    propertyId: string
    sourceEpoch: number
    resourceName: string
  }>,
): Uint8Array {
  if (!Number.isSafeInteger(input.sourceEpoch) || input.sourceEpoch < 0) {
    fail('sourceEpoch must be a nonnegative safe integer')
  }
  const organization = organizationScopeBytes(input.organizationId)
  const property = uuid16(input.propertyId, 'propertyId')
  const resource = encoder.encode(parseReviewProviderResource(input.resourceName).name)
  const scope = new Uint8Array(organization.byteLength + 16 + 8 + 4 + resource.byteLength)
  let offset = 0
  scope.set(organization, offset)
  offset += organization.byteLength
  scope.set(property, offset)
  offset += property.byteLength
  const view = new DataView(scope.buffer)
  view.setBigUint64(offset, BigInt(input.sourceEpoch), false)
  offset += 8
  view.setUint32(offset, resource.byteLength, false)
  offset += 4
  scope.set(resource, offset)
  return scope
}

function hmac(key: Uint8Array, domain: Uint8Array, scope: Uint8Array): Uint8Array {
  const digest = createHmac('sha256', key).update(domain).update(scope).digest()
  return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength).slice()
}

export function deriveReviewProviderSubject(
  input: ReviewProviderSubjectInput,
): ReviewProviderSubject {
  if (!KEY_VERSION.test(input.keyVersion)) fail('keyVersion is invalid')
  if (!(input.key instanceof Uint8Array) || input.key.byteLength < 32) {
    fail('key must contain at least 32 bytes')
  }
  const scope = encodeReviewProviderSubjectScope(input)
  return Object.freeze({
    contractVersion: REVIEW_PROVIDER_SUBJECT_CONTRACT_VERSION,
    keyVersion: input.keyVersion,
    locatorHmac: hmac(input.key, LOCATOR_DOMAIN, scope),
    verifierHmac: hmac(input.key, VERIFIER_DOMAIN, scope),
  })
}

export function reviewProviderSubjectsEqual(
  left: Pick<ReviewProviderSubject, 'keyVersion' | 'locatorHmac' | 'verifierHmac'>,
  right: Pick<ReviewProviderSubject, 'keyVersion' | 'locatorHmac' | 'verifierHmac'>,
): boolean {
  return (
    left.keyVersion === right.keyVersion &&
    left.locatorHmac.byteLength === 32 &&
    right.locatorHmac.byteLength === 32 &&
    left.verifierHmac.byteLength === 32 &&
    right.verifierHmac.byteLength === 32 &&
    timingSafeEqual(left.locatorHmac, right.locatorHmac) &&
    timingSafeEqual(left.verifierHmac, right.verifierHmac)
  )
}
