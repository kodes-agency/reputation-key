import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CREDENTIAL_BROKER_LIVE_EXECUTION_ENABLED,
  evaluateGoogleCredentialBrokerReadiness,
  parseGoogleCredentialBrokerRuntimeConfig,
} from './google-credential-broker-runtime'

const pem = (label: string) =>
  Buffer.from(`-----BEGIN ${label}-----\nopaque\n-----END ${label}-----`).toString(
    'base64',
  )

const configured = () => ({
  GOOGLE_CREDENTIAL_BROKER_MODE: 'validate_only',
  GOOGLE_CREDENTIAL_BROKER_PUBLIC_ORIGIN: 'tls://roundhouse.proxy.rlwy.net:31234',
  GOOGLE_CREDENTIAL_BROKER_SERVER_NAME: 'broker-us.reputationkey.app',
  GOOGLE_CREDENTIAL_BROKER_SERVICE_IDENTITY:
    'spiffe://repkey/cell-us/google-credential-broker',
  GOOGLE_CREDENTIAL_BROKER_PEER_IDENTITIES:
    'spiffe://repkey/cell-europe/google-gateway,spiffe://repkey/cell-global/google-gateway',
  GOOGLE_CREDENTIAL_BROKER_MTLS_CA_B64: pem('CERTIFICATE'),
  GOOGLE_CREDENTIAL_BROKER_MTLS_CERT_B64: pem('CERTIFICATE'),
  GOOGLE_CREDENTIAL_BROKER_MTLS_KEY_B64: pem('PRIVATE KEY'),
  GOOGLE_CREDENTIAL_BROKER_SIGNATURE_HMAC_KEYS: `v1:${'11'.repeat(32)}`,
  GOOGLE_CREDENTIAL_BROKER_REPLAY_HMAC_KEYS: `v1:${'22'.repeat(32)}`,
  GOOGLE_CREDENTIAL_ROUTING_HMAC_KEYS: `v1:${'33'.repeat(32)}`,
})

describe('Google credential broker Railway runtime contract', () => {
  it('accepts only an authenticated public TCP self-TLS validation endpoint', () => {
    expect(parseGoogleCredentialBrokerRuntimeConfig(configured())).toMatchObject({
      mode: 'validate_only',
      publicEndpoint: {
        hostname: 'roundhouse.proxy.rlwy.net',
        port: 31234,
        serverName: 'broker-us.reputationkey.app',
      },
      serviceIdentity: 'spiffe://repkey/cell-us/google-credential-broker',
      peerIdentities: [
        'spiffe://repkey/cell-europe/google-gateway',
        'spiffe://repkey/cell-global/google-gateway',
      ],
      keyVersions: {
        protocolSignature: 'v1',
        replayLookup: 'v1',
        routingDirectory: 'v1',
      },
    })
    expect(GOOGLE_CREDENTIAL_BROKER_LIVE_EXECUTION_ENABLED).toBe(false)
  })

  it.each([
    ['Railway private DNS', 'tls://broker.railway.internal:443'],
    ['loopback', 'tls://127.0.0.1:443'],
    ['private IPv4', 'tls://10.0.0.4:443'],
    ['clear HTTP', 'http://roundhouse.proxy.rlwy.net:31234'],
    ['credential-bearing URL', 'tls://user:pass@roundhouse.proxy.rlwy.net:31234'],
  ])(
    'rejects %s rather than pretending it is cross-environment transport',
    (_name, origin) => {
      expect(() =>
        parseGoogleCredentialBrokerRuntimeConfig({
          ...configured(),
          GOOGLE_CREDENTIAL_BROKER_PUBLIC_ORIGIN: origin,
        }),
      ).toThrow(/public|TLS|credential/iu)
    },
  )

  it('rejects partial, ambiguous, duplicate, or disabled-but-configured transport', () => {
    const partial = configured()
    delete (partial as Partial<typeof partial>).GOOGLE_CREDENTIAL_BROKER_MTLS_KEY_B64
    expect(() => parseGoogleCredentialBrokerRuntimeConfig(partial)).toThrow(/incomplete/u)
    expect(() =>
      parseGoogleCredentialBrokerRuntimeConfig({
        ...configured(),
        GOOGLE_CREDENTIAL_BROKER_PEER_IDENTITIES:
          'spiffe://repkey/cell-europe/google-gateway,spiffe://repkey/cell-europe/google-gateway',
      }),
    ).toThrow(/duplicated/u)
    expect(() =>
      parseGoogleCredentialBrokerRuntimeConfig({
        ...configured(),
        GOOGLE_CREDENTIAL_BROKER_MODE: 'disabled',
      }),
    ).toThrow(/disabled/u)
  })

  it('reports validation readiness separately from deliberately dark live execution', () => {
    const config = parseGoogleCredentialBrokerRuntimeConfig(configured())
    expect(
      evaluateGoogleCredentialBrokerReadiness({
        config,
        signedDirectoryCurrent: true,
        durableReplayStoreReachable: true,
        peerCertificateEvidenceCurrent: false,
        liveCrossCellDrillCurrent: false,
        crossCellRouteCount: 0,
      }),
    ).toEqual({
      configurationReady: true,
      protocolValidationReady: true,
      crossCellExecutionReady: false,
      readyForCurrentTraffic: true,
      code: 'live_evidence_pending',
    })
    expect(
      evaluateGoogleCredentialBrokerReadiness({
        config,
        signedDirectoryCurrent: true,
        durableReplayStoreReachable: true,
        peerCertificateEvidenceCurrent: true,
        liveCrossCellDrillCurrent: true,
        crossCellRouteCount: 1,
      }),
    ).toMatchObject({
      crossCellExecutionReady: false,
      readyForCurrentTraffic: false,
      code: 'live_execution_dark',
    })
  })
})
