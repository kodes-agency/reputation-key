import { describe, expect, it } from 'vitest'
import {
  GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES,
  assertGoogleGatewayEnvironmentIsIsolated,
  assertGoogleGatewayRequiredEnvironment,
} from './environment'

function environment(): Record<string, string> {
  return {
    ...Object.fromEntries(
      GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, 'masked']),
    ),
    HOST: '0.0.0.0',
    PORT: '8443',
    GOOGLE_EXECUTION_ADMISSION_ORIGIN:
      'https://google-execution-admission.railway.internal:8443',
    GOOGLE_EXECUTION_ADMISSION_SERVER_NAME: 'google-execution-admission',
    GOOGLE_EGRESS_GATEWAY_IDENTITY: 'spiffe://repkey.internal/google-egress-gateway',
    GOOGLE_PROVIDER_ROUTE_PROFILE: 'production',
    RELEASE_SHA: 'a'.repeat(40),
    IMAGE_SOURCE_REVISION: 'a'.repeat(40),
  }
}

describe('Google egress-gateway startup isolation', () => {
  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'GOOGLE_CLIENT_SECRET',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'RESEND_API_KEY',
    'RAILWAY_TOKEN',
    'UNKNOWN_FLAG',
    'release_sha',
  ])('rejects every unowned or noncanonical %s', (name) => {
    expect(() => assertGoogleGatewayEnvironmentIsIsolated({ [name]: 'secret' })).toThrow(
      name,
    )
  })

  it('accepts the production variable-only contract', () => {
    expect(() => assertGoogleGatewayRequiredEnvironment(environment())).not.toThrow()
  })

  it('accepts one complete legacy path triplet only during cutover', () => {
    const legacy = environment()
    delete legacy.GOOGLE_INTERNAL_MTLS_CA_B64
    delete legacy.GOOGLE_INTERNAL_MTLS_CERT_B64
    delete legacy.GOOGLE_INTERNAL_MTLS_KEY_B64
    legacy.GOOGLE_INTERNAL_MTLS_CA_PATH = '/run/repkey/ca.crt'
    legacy.GOOGLE_INTERNAL_MTLS_CERT_PATH = '/run/repkey/gateway.crt'
    legacy.GOOGLE_INTERNAL_MTLS_KEY_PATH = '/run/repkey/gateway.key'
    expect(() => assertGoogleGatewayRequiredEnvironment(legacy)).not.toThrow()
  })

  it('rejects mixed material and provider simulator drift in production', () => {
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        GOOGLE_INTERNAL_MTLS_CA_PATH: '/run/repkey/ca.crt',
        GOOGLE_INTERNAL_MTLS_CERT_PATH: '/run/repkey/gateway.crt',
        GOOGLE_INTERNAL_MTLS_KEY_PATH: '/run/repkey/gateway.key',
      }),
    ).toThrow('mTLS configuration is invalid')
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        GOOGLE_PROVIDER_SIMULATOR_ORIGIN: 'https://simulator.invalid',
      }),
    ).toThrow('production gateway private route is invalid')
  })

  it('rejects private-route and release-identity drift', () => {
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        GOOGLE_EXECUTION_ADMISSION_ORIGIN: 'https://other.invalid:8443',
      }),
    ).toThrow('private route is invalid')
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        IMAGE_SOURCE_REVISION: 'b'.repeat(40),
      }),
    ).toThrow('RELEASE_SHA does not match')
  })
})
