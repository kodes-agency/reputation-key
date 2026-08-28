import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  decideGoogleCredentialExecution,
  signGoogleCredentialBrokerGrant,
  signGoogleCredentialBrokerRequest,
  validateGoogleCredentialBrokerGrant,
} from './credential-broker-contract'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const keys = () => createVersionedHmacKeyring(`v1:${'22'.repeat(32)}`)
const accepting = (value: string) => ['us', 'europe', 'global'].includes(value)

function fixture() {
  const keyring = keys()
  const request = signGoogleCredentialBrokerRequest(
    {
      contractVersion: 'v1',
      requestId: 'broker-request-00000001',
      nonce: 'request_nonce_0000000001',
      homeCellId: 'us',
      targetCellId: 'europe',
      targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
      organizationId: 'org-1',
      connectionId: 'connection-1',
      propertyId: 'property-1',
      routeKey: 'reviews.list',
      routeCatalogueVersion: '2026-08-27',
      authorization: {
        credentialHomeAuthorityGeneration: 2,
        connectionLifecycleVersion: 4,
        connectionAccessVersion: 6,
        credentialGeneration: 8,
        propertySourceEpoch: 3,
      },
      requestBindingSha256: HASH_A,
      credentialBinding: HASH_B,
      routingDirectoryRevision: 11,
      routingPolicyVersion: 2,
      issuedAtMs: NOW - 500,
      expiresAtMs: NOW + 20_000,
    },
    keyring,
  )
  const grant = signGoogleCredentialBrokerGrant(
    {
      contractVersion: 'v1',
      grantId: 'broker-grant-00000001',
      request,
      oneUseNonce: 'grant_nonce_00000000001',
      materialReference: {
        kind: 'sealed-credential-reference-v1',
        locator: 'vault:google/ephemeral/opaque-1',
        encryptionKeyId: 'broker-envelope-v1',
        bindingSha256: HASH_B,
      },
      issuedAtMs: NOW - 250,
      expiresAtMs: NOW + 15_000,
    },
    keyring,
  )
  const expected = {
    keys: keyring,
    nowMs: NOW,
    localTargetCellId: 'europe' as const,
    homeCellId: 'us' as const,
    targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
    organizationId: 'org-1',
    connectionId: 'connection-1',
    propertyId: 'property-1',
    routeKey: 'reviews.list' as const,
    authorization: request.authorization,
    requestBindingSha256: HASH_A,
    credentialBinding: HASH_B,
    routingDirectoryRevision: 11,
    routingPolicyVersion: 2,
    isAcceptingCell: accepting,
  }
  return { keyring, grant, expected }
}

describe('Google credential broker contract', () => {
  it('authorizes only a matching signed cross-cell operation as broker mode', () => {
    const { grant, expected } = fixture()
    expect(validateGoogleCredentialBrokerGrant(grant, expected)).toMatchObject({
      ok: true,
    })
    expect(
      decideGoogleCredentialExecution(
        {
          localTargetCellId: 'europe',
          propertyTargetCellId: 'europe',
          credentialHomeCellId: 'us',
          brokerGrant: grant,
        },
        expected,
      ),
    ).toMatchObject({ kind: 'broker' })
  })

  it('keeps direct execution local to both the exact target and credential home', () => {
    const { expected } = fixture()
    expect(
      decideGoogleCredentialExecution(
        {
          localTargetCellId: 'us',
          propertyTargetCellId: 'us',
          credentialHomeCellId: 'us',
        },
        expected,
      ),
    ).toEqual({ kind: 'direct' })
    expect(
      decideGoogleCredentialExecution(
        {
          localTargetCellId: 'europe',
          propertyTargetCellId: 'europe',
          credentialHomeCellId: 'us',
        },
        expected,
      ),
    ).toEqual({ kind: 'deny', code: 'broker_grant_required' })
    expect(
      decideGoogleCredentialExecution(
        {
          localTargetCellId: 'europe',
          propertyTargetCellId: 'global',
          credentialHomeCellId: 'us',
        },
        expected,
      ),
    ).toEqual({ kind: 'deny', code: 'wrong_target' })
  })

  it.each([
    [
      'wrong gateway',
      { targetGatewayIdentity: 'spiffe://wrong/gateway' },
      'wrong_gateway',
    ],
    ['wrong route', { routeKey: 'reviews.get' as const }, 'wrong_route'],
    [
      'stale credential generation',
      {
        authorization: {
          credentialHomeAuthorityGeneration: 2,
          connectionLifecycleVersion: 4,
          connectionAccessVersion: 6,
          credentialGeneration: 9,
          propertySourceEpoch: 3,
        },
      },
      'authorization_changed',
    ],
    [
      'stale credential-home authority generation',
      {
        authorization: {
          credentialHomeAuthorityGeneration: 3,
          connectionLifecycleVersion: 4,
          connectionAccessVersion: 6,
          credentialGeneration: 8,
          propertySourceEpoch: 3,
        },
      },
      'authorization_changed',
    ],
    ['stale routing revision', { routingDirectoryRevision: 12 }, 'routing_changed'],
    ['expired grant', { nowMs: NOW + 15_001 }, 'expired'],
  ] as const)('rejects %s', (_name, override, code) => {
    const { grant, expected } = fixture()
    expect(
      validateGoogleCredentialBrokerGrant(grant, { ...expected, ...override }),
    ).toEqual({ ok: false, code })
  })

  it('rejects tampering and a material reference bound to another credential', () => {
    const { grant, expected, keyring } = fixture()
    expect(
      validateGoogleCredentialBrokerGrant(
        {
          ...grant,
          targetGatewayIdentity: 'ignored',
          signature: `A${grant.signature.slice(1)}`,
        },
        expected,
      ),
    ).toEqual({ ok: false, code: 'malformed' })

    const wrongMaterial = signGoogleCredentialBrokerGrant(
      {
        contractVersion: grant.contractVersion,
        grantId: grant.grantId,
        request: grant.request,
        oneUseNonce: grant.oneUseNonce,
        materialReference: { ...grant.materialReference, bindingSha256: HASH_A },
        issuedAtMs: grant.issuedAtMs,
        expiresAtMs: grant.expiresAtMs,
      },
      keyring,
    )
    expect(validateGoogleCredentialBrokerGrant(wrongMaterial, expected)).toEqual({
      ok: false,
      code: 'material_mismatch',
    })
  })
})
