import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  signGoogleCredentialBrokerGrant,
  signGoogleCredentialBrokerRequest,
} from './credential-broker-contract'
import {
  credentialBrokerReplayIssueFromGrant,
  credentialBrokerReplayLookupCandidates,
} from './credential-broker-durable-state'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function grant() {
  const signatureKeys = createVersionedHmacKeyring(`v1:${'22'.repeat(32)}`)
  const request = signGoogleCredentialBrokerRequest(
    {
      contractVersion: 'v1',
      requestId: 'broker-request-durable-1',
      nonce: 'request_nonce_durable_001',
      homeCellId: 'us',
      targetCellId: 'europe',
      targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
      organizationId: 'org-durable-1',
      connectionId: 'connection-durable-1',
      propertyId: 'property-durable-1',
      routeKey: 'reviews.list',
      routeCatalogueVersion: '2026-08-27',
      authorization: {
        credentialHomeAuthorityGeneration: 2,
        connectionLifecycleVersion: 4,
        connectionAccessVersion: 5,
        credentialGeneration: 6,
        propertySourceEpoch: 7,
      },
      requestBindingSha256: HASH_A,
      credentialBinding: HASH_B,
      routingDirectoryRevision: 8,
      routingPolicyVersion: 2,
      issuedAtMs: NOW,
      expiresAtMs: NOW + 20_000,
    },
    signatureKeys,
  )
  return signGoogleCredentialBrokerGrant(
    {
      contractVersion: 'v1',
      grantId: 'broker-grant-durable-1',
      request,
      oneUseNonce: 'grant_nonce_durable_0001',
      materialReference: {
        kind: 'sealed-credential-reference-v1',
        locator: 'vault:google/ephemeral/durable-1',
        encryptionKeyId: 'broker-envelope-v1',
        bindingSha256: HASH_B,
      },
      issuedAtMs: NOW,
      expiresAtMs: NOW + 15_000,
    },
    signatureKeys,
  )
}

describe('durable Google credential broker replay state', () => {
  it('derives lookup hashes and persists only content-free bindings plus an opaque sealed reference', () => {
    const replayKeys = createVersionedHmacKeyring(
      `v2:${'44'.repeat(32)},v1:${'33'.repeat(32)}`,
    )
    const value = grant()
    const record = credentialBrokerReplayIssueFromGrant(value, replayKeys, NOW)

    expect(record).toMatchObject({
      organizationId: 'org-durable-1',
      connectionId: 'connection-durable-1',
      propertyId: 'property-durable-1',
      routeKey: 'reviews.list',
      homeCellId: 'us',
      targetCellId: 'europe',
      targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
      lookupKeyVersion: 'v2',
      grantIdHmac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      oneUseNonceHmac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      requestDigestSha256: value.requestDigestSha256,
      materialReference: value.materialReference,
      expiresAtMs: value.expiresAtMs,
    })
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain(value.grantId)
    expect(serialized).not.toContain(value.oneUseNonce)
    expect(serialized).not.toContain(value.request.signature)
    expect(serialized).not.toMatch(/accessToken|refreshToken|reviewText|guest/iu)
  })

  it('derives active and retained lookup candidates for a bounded rotation window', () => {
    const replayKeys = createVersionedHmacKeyring(
      `v2:${'44'.repeat(32)},v1:${'33'.repeat(32)}`,
    )
    const value = grant()
    const candidates = credentialBrokerReplayLookupCandidates(value, replayKeys)
    expect(candidates.map((entry) => entry.lookupKeyVersion)).toEqual(['v2', 'v1'])
    expect(candidates).toHaveLength(2)
    expect(candidates.every((entry) => entry.grantIdHmac !== value.grantId)).toBe(true)
  })

  it('rejects an already expired or malformed issue rather than storing it', () => {
    const replayKeys = createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`)
    const value = grant()
    expect(() =>
      credentialBrokerReplayIssueFromGrant(value, replayKeys, value.expiresAtMs),
    ).toThrow(/expired/u)
    expect(() =>
      credentialBrokerReplayIssueFromGrant(
        { ...value, oneUseNonce: 'short' },
        replayKeys,
        NOW,
      ),
    ).toThrow(/malformed/u)
  })
})
