import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { SAFE_OPAQUE_IDENTIFIER_PATTERN } from '#/shared/domain/safe-identifier'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  type GoogleProviderRouteKey,
} from './contracts'

const GOOGLE_CREDENTIAL_BROKER_CONTRACT_VERSION = 'v1' as const
export const GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS = 30_000
const REQUEST_AUDIENCE = 'google-credential-broker-request-v1'
const GRANT_AUDIENCE = 'google-credential-broker-grant-v1'

const safeId = z.string().regex(SAFE_OPAQUE_IDENTIFIER_PATTERN)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const signatureFields = {
  signatureKeyVersion: z.string().min(1).max(32),
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}
const authorizationSchema = z
  .object({
    connectionLifecycleVersion: z.number().int().safe().positive(),
    connectionAccessVersion: z.number().int().safe().positive(),
    credentialGeneration: z.number().int().safe().positive(),
    propertySourceEpoch: z.number().int().safe().nonnegative(),
  })
  .strict()

const unsignedRequestSchema = z
  .object({
    contractVersion: z.literal(GOOGLE_CREDENTIAL_BROKER_CONTRACT_VERSION),
    requestId: safeId,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u),
    organizationId: safeId,
    connectionId: safeId,
    propertyId: safeId,
    routeKey: z.enum(GOOGLE_PROVIDER_ROUTE_KEYS),
    routeCatalogueVersion: z.literal(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION),
    authorization: authorizationSchema,
    requestBindingSha256: sha256,
    credentialBinding: sha256,
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
const requestSchema = unsignedRequestSchema.extend(signatureFields).strict()

const materialReferenceSchema = z
  .object({
    kind: z.literal('sealed-credential-reference-v1'),
    locator: safeId,
    encryptionKeyId: safeId,
    bindingSha256: sha256,
  })
  .strict()

const unsignedGrantSchema = z
  .object({
    contractVersion: z.literal(GOOGLE_CREDENTIAL_BROKER_CONTRACT_VERSION),
    grantId: safeId,
    request: requestSchema,
    requestDigestSha256: sha256,
    oneUseNonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u),
    materialReference: materialReferenceSchema,
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().positive(),
  })
  .strict()
const grantSchema = unsignedGrantSchema.extend(signatureFields).strict()

export type GoogleCredentialBrokerAuthorization = z.infer<typeof authorizationSchema>
export type UnsignedGoogleCredentialBrokerRequest = z.infer<typeof unsignedRequestSchema>
export type GoogleCredentialBrokerRequest = z.infer<typeof requestSchema>
export type UnsignedGoogleCredentialBrokerGrant = z.infer<typeof unsignedGrantSchema>
export type GoogleCredentialBrokerGrant = z.infer<typeof grantSchema>

export type GoogleCredentialBrokerDenyCode =
  | 'malformed'
  | 'signature_invalid'
  | 'not_yet_valid'
  | 'expired'
  | 'ttl_exceeded'
  | 'wrong_organization'
  | 'wrong_connection'
  | 'wrong_property'
  | 'wrong_route'
  | 'authorization_changed'
  | 'request_mismatch'
  | 'credential_mismatch'
  | 'material_mismatch'

function requestValue(request: UnsignedGoogleCredentialBrokerRequest): string {
  return JSON.stringify([
    request.contractVersion,
    request.requestId,
    request.nonce,
    request.organizationId,
    request.connectionId,
    request.propertyId,
    request.routeKey,
    request.routeCatalogueVersion,
    request.authorization.connectionLifecycleVersion,
    request.authorization.connectionAccessVersion,
    request.authorization.credentialGeneration,
    request.authorization.propertySourceEpoch,
    request.requestBindingSha256,
    request.credentialBinding,
    request.issuedAtMs,
    request.expiresAtMs,
  ])
}

function unsignedRequest(request: GoogleCredentialBrokerRequest) {
  const { signatureKeyVersion: _keyVersion, signature: _signature, ...unsigned } = request
  return unsigned
}

function requestDigest(request: GoogleCredentialBrokerRequest): string {
  return createHash('sha256')
    .update(requestValue(unsignedRequest(request)))
    .digest('hex')
}

function grantValue(grant: UnsignedGoogleCredentialBrokerGrant): string {
  return JSON.stringify([
    grant.contractVersion,
    grant.grantId,
    grant.requestDigestSha256,
    grant.request.signatureKeyVersion,
    grant.request.signature,
    grant.oneUseNonce,
    grant.materialReference.kind,
    grant.materialReference.locator,
    grant.materialReference.encryptionKeyId,
    grant.materialReference.bindingSha256,
    grant.issuedAtMs,
    grant.expiresAtMs,
  ])
}

function unsignedGrant(grant: GoogleCredentialBrokerGrant) {
  const { signatureKeyVersion: _keyVersion, signature: _signature, ...unsigned } = grant
  return unsigned
}

export function signGoogleCredentialBrokerRequest(
  input: UnsignedGoogleCredentialBrokerRequest,
  keys: VersionedHmacKeyring,
): GoogleCredentialBrokerRequest {
  const parsed = unsignedRequestSchema.parse(input)
  const signed = keys.sign(REQUEST_AUDIENCE, requestValue(parsed))
  return Object.freeze({
    ...parsed,
    signatureKeyVersion: signed.keyVersion,
    signature: signed.digest,
  })
}

export function signGoogleCredentialBrokerGrant(
  input: Omit<UnsignedGoogleCredentialBrokerGrant, 'requestDigestSha256'> &
    Readonly<{ requestDigestSha256?: string }>,
  keys: VersionedHmacKeyring,
): GoogleCredentialBrokerGrant {
  const parsed = unsignedGrantSchema.parse({
    ...input,
    requestDigestSha256: input.requestDigestSha256 ?? requestDigest(input.request),
  })
  const signed = keys.sign(GRANT_AUDIENCE, grantValue(parsed))
  return Object.freeze({
    ...parsed,
    signatureKeyVersion: signed.keyVersion,
    signature: signed.digest,
  })
}

function sameAuthorization(
  left: GoogleCredentialBrokerAuthorization,
  right: GoogleCredentialBrokerAuthorization,
): boolean {
  return (
    left.connectionLifecycleVersion === right.connectionLifecycleVersion &&
    left.connectionAccessVersion === right.connectionAccessVersion &&
    left.credentialGeneration === right.credentialGeneration &&
    left.propertySourceEpoch === right.propertySourceEpoch
  )
}

export type GoogleCredentialBrokerExpectation = Readonly<{
  keys: VersionedHmacKeyring
  nowMs: number
  organizationId: string
  connectionId: string
  propertyId: string
  routeKey: GoogleProviderRouteKey
  authorization: GoogleCredentialBrokerAuthorization
  requestBindingSha256: string
  credentialBinding: string
}>

/**
 * Envelope rules: both signatures verify, the grant covers this exact request,
 * and both documents are inside their own bounded TTL windows.
 */
function brokerEnvelopeDenial(
  grant: GoogleCredentialBrokerGrant,
  expected: GoogleCredentialBrokerExpectation,
): GoogleCredentialBrokerDenyCode | null {
  const request = grant.request
  if (
    !expected.keys.verify(
      REQUEST_AUDIENCE,
      requestValue(unsignedRequest(request)),
      request.signatureKeyVersion,
      request.signature,
    ) ||
    !expected.keys.verify(
      GRANT_AUDIENCE,
      grantValue(unsignedGrant(grant)),
      grant.signatureKeyVersion,
      grant.signature,
    )
  ) {
    return 'signature_invalid'
  }
  if (grant.requestDigestSha256 !== requestDigest(request)) return 'request_mismatch'
  if (request.issuedAtMs > expected.nowMs || grant.issuedAtMs > expected.nowMs) {
    return 'not_yet_valid'
  }
  if (request.expiresAtMs <= expected.nowMs || grant.expiresAtMs <= expected.nowMs) {
    return 'expired'
  }
  if (
    request.expiresAtMs <= request.issuedAtMs ||
    grant.expiresAtMs <= grant.issuedAtMs ||
    request.expiresAtMs - request.issuedAtMs > GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS ||
    grant.expiresAtMs - grant.issuedAtMs > GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS ||
    grant.expiresAtMs > request.expiresAtMs
  ) {
    return 'ttl_exceeded'
  }
  return null
}

/** The request must name this exact tenant-scoped provider operation. */
function brokerRouteDenial(
  request: GoogleCredentialBrokerRequest,
  expected: GoogleCredentialBrokerExpectation,
): GoogleCredentialBrokerDenyCode | null {
  if (request.organizationId !== expected.organizationId) return 'wrong_organization'
  if (request.connectionId !== expected.connectionId) return 'wrong_connection'
  if (request.propertyId !== expected.propertyId) return 'wrong_property'
  if (request.routeKey !== expected.routeKey) return 'wrong_route'
  return null
}

/**
 * The grant must still bind the authorization, request and credential material
 * the caller is holding — anything that moved underneath it is a denial.
 */
function brokerBindingDenial(
  grant: GoogleCredentialBrokerGrant,
  expected: GoogleCredentialBrokerExpectation,
): GoogleCredentialBrokerDenyCode | null {
  const request = grant.request
  if (!sameAuthorization(request.authorization, expected.authorization)) {
    return 'authorization_changed'
  }
  if (request.requestBindingSha256 !== expected.requestBindingSha256) {
    return 'request_mismatch'
  }
  if (request.credentialBinding !== expected.credentialBinding) {
    return 'credential_mismatch'
  }
  if (grant.materialReference.bindingSha256 !== request.credentialBinding) {
    return 'material_mismatch'
  }
  return null
}

export function validateGoogleCredentialBrokerGrant(
  input: unknown,
  expected: GoogleCredentialBrokerExpectation,
):
  | Readonly<{ ok: true; value: GoogleCredentialBrokerGrant }>
  | Readonly<{ ok: false; code: GoogleCredentialBrokerDenyCode }> {
  const parsed = grantSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'malformed' }
  const grant = parsed.data

  const denial =
    brokerEnvelopeDenial(grant, expected) ??
    brokerRouteDenial(grant.request, expected) ??
    brokerBindingDenial(grant, expected)
  if (denial) return { ok: false, code: denial }

  return { ok: true, value: grant }
}
