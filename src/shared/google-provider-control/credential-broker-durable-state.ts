import type { DataCellId } from '#/shared/domain/data-cell-catalogue'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleProviderRouteKey } from './contracts'
import {
  GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS,
  type GoogleCredentialBrokerAuthorization,
  type GoogleCredentialBrokerGrant,
} from './credential-broker-contract'

const GRANT_LOOKUP_AUDIENCE = 'google-credential-broker-grant-lookup-v1'
const NONCE_LOOKUP_AUDIENCE = 'google-credential-broker-nonce-lookup-v1'

export type GoogleCredentialBrokerLookupCandidate = Readonly<{
  lookupKeyVersion: string
  grantIdHmac: string
  oneUseNonceHmac: string
}>

export type GoogleCredentialBrokerReplayIssue = GoogleCredentialBrokerLookupCandidate &
  Readonly<{
    organizationId: string
    connectionId: string
    propertyId: string
    homeCellId: DataCellId
    targetCellId: DataCellId
    targetGatewayIdentity: string
    routeKey: GoogleProviderRouteKey
    authorization: GoogleCredentialBrokerAuthorization
    requestDigestSha256: string
    credentialBindingSha256: string
    routingDirectoryRevision: number
    routingPolicyVersion: number
    materialReference: GoogleCredentialBrokerGrant['materialReference']
    issuedAtMs: number
    expiresAtMs: number
  }>

export type GoogleCredentialBrokerReplayRedeemInput = Readonly<{
  organizationId: string
  candidates: ReadonlyArray<GoogleCredentialBrokerLookupCandidate>
  expected: Omit<
    GoogleCredentialBrokerReplayIssue,
    | keyof GoogleCredentialBrokerLookupCandidate
    | 'materialReference'
    | 'issuedAtMs'
    | 'expiresAtMs'
  >
  nowMs: number
}>

export type GoogleCredentialBrokerReplayRedeemResult =
  | Readonly<{
      kind: 'redeemed'
      materialReference: GoogleCredentialBrokerReplayIssue['materialReference']
    }>
  | Readonly<{
      kind: 'unknown' | 'mismatch' | 'expired' | 'replayed'
    }>

/**
 * Production implementations must use a row lock/CAS so exactly one caller
 * moves issued→redeemed. They persist this metadata only—never a provider
 * token, guest/review content, the raw grant id, or the raw nonce.
 */
export type DurableGoogleCredentialBrokerReplayStore = Readonly<{
  issue(input: GoogleCredentialBrokerReplayIssue): Promise<'issued' | 'duplicate'>
  redeem(
    input: GoogleCredentialBrokerReplayRedeemInput,
  ): Promise<GoogleCredentialBrokerReplayRedeemResult>
  purgeExpired(input: Readonly<{ nowMs: number; limit: number }>): Promise<number>
  probe(): Promise<boolean>
}>

function lookupValue(grant: GoogleCredentialBrokerGrant): string {
  return `${grant.request.organizationId}\0${grant.grantId}`
}

function nonceValue(grant: GoogleCredentialBrokerGrant): string {
  return `${grant.request.organizationId}\0${grant.grantId}\0${grant.oneUseNonce}`
}

function deriveCandidate(
  grant: GoogleCredentialBrokerGrant,
  keys: VersionedHmacKeyring,
  keyVersion: string,
): GoogleCredentialBrokerLookupCandidate {
  const grantIdHmac = keys.derive(GRANT_LOOKUP_AUDIENCE, lookupValue(grant), keyVersion)
  const oneUseNonceHmac = keys.derive(
    NONCE_LOOKUP_AUDIENCE,
    nonceValue(grant),
    keyVersion,
  )
  if (!grantIdHmac || !oneUseNonceHmac) {
    throw new Error('Google credential broker replay key is unavailable')
  }
  return Object.freeze({ lookupKeyVersion: keyVersion, grantIdHmac, oneUseNonceHmac })
}

export function credentialBrokerReplayLookupCandidates(
  grant: GoogleCredentialBrokerGrant,
  keys: VersionedHmacKeyring,
): readonly GoogleCredentialBrokerLookupCandidate[] {
  return Object.freeze(
    [keys.activeVersion, ...keys.retainedVersions].map((version) =>
      deriveCandidate(grant, keys, version),
    ),
  )
}

function isGrantShape(value: GoogleCredentialBrokerGrant): boolean {
  return (
    value.contractVersion === 'v1' &&
    /^[A-Za-z0-9._:/-]{1,255}$/u.test(value.grantId) &&
    /^[A-Za-z0-9_-]{22,128}$/u.test(value.oneUseNonce) &&
    /^[a-f0-9]{64}$/u.test(value.requestDigestSha256) &&
    value.expiresAtMs > value.issuedAtMs &&
    value.expiresAtMs - value.issuedAtMs <= GOOGLE_CREDENTIAL_BROKER_MAX_TTL_MS
  )
}

export function credentialBrokerReplayIssueFromGrant(
  grant: GoogleCredentialBrokerGrant,
  keys: VersionedHmacKeyring,
  nowMs: number,
): GoogleCredentialBrokerReplayIssue {
  if (!isGrantShape(grant)) {
    throw new Error('Google credential broker grant is malformed')
  }
  if (grant.expiresAtMs <= nowMs) {
    throw new Error('Google credential broker grant is expired')
  }
  const lookup = deriveCandidate(grant, keys, keys.activeVersion)
  return Object.freeze({
    ...lookup,
    organizationId: grant.request.organizationId,
    connectionId: grant.request.connectionId,
    propertyId: grant.request.propertyId,
    homeCellId: grant.request.homeCellId,
    targetCellId: grant.request.targetCellId,
    targetGatewayIdentity: grant.request.targetGatewayIdentity,
    routeKey: grant.request.routeKey,
    authorization: Object.freeze({ ...grant.request.authorization }),
    requestDigestSha256: grant.requestDigestSha256,
    credentialBindingSha256: grant.request.credentialBinding,
    routingDirectoryRevision: grant.request.routingDirectoryRevision,
    routingPolicyVersion: grant.request.routingPolicyVersion,
    materialReference: Object.freeze({ ...grant.materialReference }),
    issuedAtMs: grant.issuedAtMs,
    expiresAtMs: grant.expiresAtMs,
  })
}
