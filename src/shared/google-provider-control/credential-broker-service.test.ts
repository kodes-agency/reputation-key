import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  signGoogleCredentialBrokerGrant,
  signGoogleCredentialBrokerRequest,
} from './credential-broker-contract'
import type { DurableGoogleCredentialBrokerReplayStore } from './credential-broker-durable-state'
import { createGoogleCredentialBrokerProtocolService } from './credential-broker-service'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function fixture() {
  const signatureKeys = createVersionedHmacKeyring(`v1:${'22'.repeat(32)}`)
  const request = signGoogleCredentialBrokerRequest(
    {
      contractVersion: 'v1',
      requestId: 'broker-service-request-1',
      nonce: 'request_nonce_service_0001',
      homeCellId: 'us',
      targetCellId: 'europe',
      targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
      organizationId: 'org-service-1',
      connectionId: 'connection-service-1',
      propertyId: 'property-service-1',
      routeKey: 'reviews.list',
      routeCatalogueVersion: '2026-08-27',
      authorization: {
        credentialHomeAuthorityGeneration: 1,
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 2,
        credentialGeneration: 3,
        propertySourceEpoch: 4,
      },
      requestBindingSha256: HASH_A,
      credentialBinding: HASH_B,
      routingDirectoryRevision: 5,
      routingPolicyVersion: 2,
      issuedAtMs: NOW,
      expiresAtMs: NOW + 20_000,
    },
    signatureKeys,
  )
  const grant = signGoogleCredentialBrokerGrant(
    {
      contractVersion: 'v1',
      grantId: 'broker-service-grant-1',
      request,
      oneUseNonce: 'grant_nonce_service_00001',
      materialReference: {
        kind: 'sealed-credential-reference-v1',
        locator: 'vault:google/ephemeral/service-1',
        encryptionKeyId: 'broker-envelope-v1',
        bindingSha256: HASH_B,
      },
      issuedAtMs: NOW,
      expiresAtMs: NOW + 15_000,
    },
    signatureKeys,
  )
  const expected = {
    keys: signatureKeys,
    nowMs: NOW,
    localTargetCellId: 'europe' as const,
    homeCellId: 'us' as const,
    targetGatewayIdentity: request.targetGatewayIdentity,
    organizationId: request.organizationId,
    connectionId: request.connectionId,
    propertyId: request.propertyId,
    routeKey: request.routeKey,
    authorization: request.authorization,
    requestBindingSha256: HASH_A,
    credentialBinding: HASH_B,
    routingDirectoryRevision: 5,
    routingPolicyVersion: 2,
    isAcceptingCell: () => true,
  }
  return { signatureKeys, grant, expected }
}

describe('transport-independent Google credential broker service', () => {
  it('registers only an exactly validated grant in the durable replay authority', async () => {
    const issue = vi.fn(async () => 'issued' as const)
    const store: DurableGoogleCredentialBrokerReplayStore = {
      issue,
      redeem: vi.fn(),
      purgeExpired: async () => 0,
      probe: async () => true,
    }
    const replayKeys = createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`)
    const service = createGoogleCredentialBrokerProtocolService({ store, replayKeys })
    const { grant, expected } = fixture()

    await expect(service.registerIssuedGrant({ grant, expected })).resolves.toEqual({
      ok: true,
      status: 'issued',
    })
    expect(issue).toHaveBeenCalledOnce()
    expect(JSON.stringify(issue.mock.calls)).not.toContain(grant.grantId)
  })

  it('denies a route/gateway mismatch without touching durable state', async () => {
    const issue = vi.fn(async () => 'issued' as const)
    const store: DurableGoogleCredentialBrokerReplayStore = {
      issue,
      redeem: vi.fn(),
      purgeExpired: async () => 0,
      probe: async () => true,
    }
    const service = createGoogleCredentialBrokerProtocolService({
      store,
      replayKeys: createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`),
    })
    const { grant, expected } = fixture()
    await expect(
      service.registerIssuedGrant({
        grant,
        expected: { ...expected, routeKey: 'reviews.get' },
      }),
    ).resolves.toEqual({ ok: false, code: 'wrong_route' })
    expect(issue).not.toHaveBeenCalled()
  })

  it('keeps cross-cell effect admission dark without consuming the one-use record', async () => {
    const redeem = vi.fn()
    const store: DurableGoogleCredentialBrokerReplayStore = {
      issue: vi.fn(),
      redeem,
      purgeExpired: async () => 0,
      probe: async () => true,
    }
    const service = createGoogleCredentialBrokerProtocolService({
      store,
      replayKeys: createVersionedHmacKeyring(`v1:${'33'.repeat(32)}`),
    })
    const { grant, expected } = fixture()
    await expect(service.admitCrossCellExecution({ grant, expected })).resolves.toEqual({
      ok: false,
      code: 'live_execution_dark',
    })
    expect(redeem).not.toHaveBeenCalled()
  })
})
