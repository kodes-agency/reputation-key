import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  signGoogleCredentialBrokerGrant,
  signGoogleCredentialBrokerRequest,
  validateGoogleCredentialBrokerGrant,
} from './credential-broker-contract'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const keys = () => createVersionedHmacKeyring(`v1:${'22'.repeat(32)}`)

function fixture() {
  const keyring = keys()
  const request = signGoogleCredentialBrokerRequest(
    {
      contractVersion: 'v1',
      requestId: 'broker-request-00000001',
      nonce: 'request_nonce_0000000001',
      organizationId: 'org-1',
      connectionId: 'connection-1',
      propertyId: 'property-1',
      routeKey: 'reviews.list',
      routeCatalogueVersion: '2026-08-27',
      authorization: {
        connectionLifecycleVersion: 4,
        connectionAccessVersion: 6,
        credentialGeneration: 8,
        propertySourceEpoch: 3,
      },
      requestBindingSha256: HASH_A,
      credentialBinding: HASH_B,
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
    organizationId: 'org-1',
    connectionId: 'connection-1',
    propertyId: 'property-1',
    routeKey: 'reviews.list' as const,
    authorization: request.authorization,
    requestBindingSha256: HASH_A,
    credentialBinding: HASH_B,
  }
  return { keyring, grant, expected }
}

describe('Google credential broker contract', () => {
  it('validates a signed grant for the exact provider operation', () => {
    const { grant, expected } = fixture()

    expect(validateGoogleCredentialBrokerGrant(grant, expected)).toMatchObject({
      ok: true,
    })
  })

  it.each([
    ['wrong route', { routeKey: 'reviews.get' as const }, 'wrong_route'],
    [
      'stale credential generation',
      {
        authorization: {
          connectionLifecycleVersion: 4,
          connectionAccessVersion: 6,
          credentialGeneration: 9,
          propertySourceEpoch: 3,
        },
      },
      'authorization_changed',
    ],
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
        { ...grant, signature: `A${grant.signature.slice(1)}` },
        expected,
      ),
    ).toEqual({ ok: false, code: 'signature_invalid' })

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
