import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { DATA_CELL_IDS, type DataCellId } from '#/shared/domain/data-cell-catalogue'
import { SAFE_OPAQUE_IDENTIFIER_PATTERN } from '#/shared/domain/safe-identifier'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  type GoogleProviderRouteKey,
} from './contracts'

export const GOOGLE_CREDENTIAL_BROKER_CONTRACT_VERSION = 'v1' as const
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
    credentialHomeAuthorityGeneration: z.number().int().safe().positive(),
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
    homeCellId: z.enum(DATA_CELL_IDS),
    targetCellId: z.enum(DATA_CELL_IDS),
    targetGatewayIdentity: safeId,
    organizationId: safeId,
    connectionId: safeId,
    propertyId: safeId,
    routeKey: z.enum(GOOGLE_PROVIDER_ROUTE_KEYS),
    routeCatalogueVersion: z.literal(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION),
    authorization: authorizationSchema,
    requestBindingSha256: sha256,
    credentialBinding: sha256,
    routingDirectoryRevision: z.number().int().safe().positive(),
    routingPolicyVersion: z.number().int().safe().positive(),
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
  | 'same_cell'
  | 'cell_not_accepting'
  | 'wrong_home'
  | 'wrong_target'
  | 'wrong_gateway'
  | 'wrong_organization'
  | 'wrong_connection'
  | 'wrong_property'
  | 'wrong_route'
  | 'authorization_changed'
  | 'request_mismatch'
  | 'credential_mismatch'
  | 'routing_changed'
  | 'material_mismatch'

function requestValue(request: UnsignedGoogleCredentialBrokerRequest): string {
  return JSON.stringify([
    request.contractVersion,
    request.requestId,
    request.nonce,
    request.homeCellId,
    request.targetCellId,
    request.targetGatewayIdentity,
    request.organizationId,
    request.connectionId,
    request.propertyId,
    request.routeKey,
    request.routeCatalogueVersion,
    request.authorization.credentialHomeAuthorityGeneration,
    request.authorization.connectionLifecycleVersion,
    request.authorization.connectionAccessVersion,
    request.authorization.credentialGeneration,
    request.authorization.propertySourceEpoch,
    request.requestBindingSha256,
    request.credentialBinding,
    request.routingDirectoryRevision,
    request.routingPolicyVersion,
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
    left.credentialHomeAuthorityGeneration === right.credentialHomeAuthorityGeneration &&
    left.connectionLifecycleVersion === right.connectionLifecycleVersion &&
    left.connectionAccessVersion === right.connectionAccessVersion &&
    left.credentialGeneration === right.credentialGeneration &&
    left.propertySourceEpoch === right.propertySourceEpoch
  )
}

export function validateGoogleCredentialBrokerGrant(
  input: unknown,
  expected: Readonly<{
    keys: VersionedHmacKeyring
    nowMs: number
    localTargetCellId: DataCellId
    homeCellId: DataCellId
    targetGatewayIdentity: string
    organizationId: string
    connectionId: string
    propertyId: string
    routeKey: GoogleProviderRouteKey
    authorization: GoogleCredentialBrokerAuthorization
    requestBindingSha256: string
    credentialBinding: string
    routingDirectoryRevision: number
    routingPolicyVersion: number
    isAcceptingCell: (cellId: string) => boolean
  }>,
):
  | Readonly<{ ok: true; value: GoogleCredentialBrokerGrant }>
  | Readonly<{ ok: false; code: GoogleCredentialBrokerDenyCode }> {
  const parsed = grantSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'malformed' }
  const grant = parsed.data
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
    return { ok: false, code: 'signature_invalid' }
  }
  if (grant.requestDigestSha256 !== requestDigest(request)) {
    return { ok: false, code: 'request_mismatch' }
  }
  if (request.issuedAtMs > expected.nowMs || grant.issuedAtMs > expected.nowMs) {
    return { ok: false, code: 'not_yet_valid' }
  }
  if (request.expiresAtMs <= expected.nowMs || grant.expiresAtMs <= expected.nowMs) {
    return { ok: false, code: 'expired' }
  }
  if (
    request.expiresAtMs <= request.issuedAtMs ||
    grant.expiresAtMs <= grant.issuedAtMs ||
    request.expiresAtMs - request.issuedAtMs > GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS ||
    grant.expiresAtMs - grant.issuedAtMs > GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS ||
    grant.expiresAtMs > request.expiresAtMs
  ) {
    return { ok: false, code: 'ttl_exceeded' }
  }
  if (request.homeCellId === request.targetCellId) return { ok: false, code: 'same_cell' }
  if (
    !expected.isAcceptingCell(request.homeCellId) ||
    !expected.isAcceptingCell(request.targetCellId)
  ) {
    return { ok: false, code: 'cell_not_accepting' }
  }
  if (request.homeCellId !== expected.homeCellId) return { ok: false, code: 'wrong_home' }
  if (request.targetCellId !== expected.localTargetCellId) {
    return { ok: false, code: 'wrong_target' }
  }
  if (request.targetGatewayIdentity !== expected.targetGatewayIdentity) {
    return { ok: false, code: 'wrong_gateway' }
  }
  if (request.organizationId !== expected.organizationId) {
    return { ok: false, code: 'wrong_organization' }
  }
  if (request.connectionId !== expected.connectionId) {
    return { ok: false, code: 'wrong_connection' }
  }
  if (request.propertyId !== expected.propertyId) {
    return { ok: false, code: 'wrong_property' }
  }
  if (request.routeKey !== expected.routeKey) return { ok: false, code: 'wrong_route' }
  if (!sameAuthorization(request.authorization, expected.authorization)) {
    return { ok: false, code: 'authorization_changed' }
  }
  if (request.requestBindingSha256 !== expected.requestBindingSha256) {
    return { ok: false, code: 'request_mismatch' }
  }
  if (request.credentialBinding !== expected.credentialBinding) {
    return { ok: false, code: 'credential_mismatch' }
  }
  if (
    request.routingDirectoryRevision !== expected.routingDirectoryRevision ||
    request.routingPolicyVersion !== expected.routingPolicyVersion
  ) {
    return { ok: false, code: 'routing_changed' }
  }
  if (grant.materialReference.bindingSha256 !== request.credentialBinding) {
    return { ok: false, code: 'material_mismatch' }
  }
  return { ok: true, value: grant }
}

export type GoogleCredentialExecutionDecision =
  | Readonly<{ kind: 'direct' }>
  | Readonly<{ kind: 'broker'; grant: GoogleCredentialBrokerGrant }>
  | Readonly<{
      kind: 'deny'
      code:
        | 'wrong_target'
        | 'cell_not_accepting'
        | 'broker_grant_required'
        | GoogleCredentialBrokerDenyCode
    }>

export function decideGoogleCredentialExecution(
  input: Readonly<{
    localTargetCellId: DataCellId
    propertyTargetCellId: DataCellId
    credentialHomeCellId: DataCellId
    brokerGrant?: unknown
  }>,
  expectedGrant: Omit<
    Parameters<typeof validateGoogleCredentialBrokerGrant>[1],
    'localTargetCellId' | 'homeCellId'
  >,
): GoogleCredentialExecutionDecision {
  if (
    !expectedGrant.isAcceptingCell(input.localTargetCellId) ||
    !expectedGrant.isAcceptingCell(input.propertyTargetCellId) ||
    !expectedGrant.isAcceptingCell(input.credentialHomeCellId)
  ) {
    return { kind: 'deny', code: 'cell_not_accepting' }
  }
  if (input.propertyTargetCellId !== input.localTargetCellId) {
    return { kind: 'deny', code: 'wrong_target' }
  }
  if (input.credentialHomeCellId === input.localTargetCellId) return { kind: 'direct' }
  if (input.brokerGrant === undefined) {
    return { kind: 'deny', code: 'broker_grant_required' }
  }
  const validated = validateGoogleCredentialBrokerGrant(input.brokerGrant, {
    ...expectedGrant,
    localTargetCellId: input.localTargetCellId,
    homeCellId: input.credentialHomeCellId,
  })
  return validated.ok
    ? { kind: 'broker', grant: validated.value }
    : { kind: 'deny', code: validated.code }
}
