import { describe, expect, it } from 'vitest'
import {
  GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES,
  assertGoogleGatewayEnvironmentIsIsolated,
  assertGoogleGatewayRequiredLocalEnvironment,
  assertGoogleGatewayRequiredEnvironment,
  assertGoogleGatewayRequiredProductionEnvironment,
} from './environment'

function environment(): Record<string, string> {
  return {
    ...Object.fromEntries(
      GOOGLE_GATEWAY_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, 'masked']),
    ),
    HOST: '0.0.0.0',
    PORT: '8080',
    INTERNAL_MTLS_PORT: '8443',
    PROCESSING_CELL: 'us',
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
    expect(() =>
      assertGoogleGatewayRequiredProductionEnvironment(environment()),
    ).not.toThrow()
  })

  // Railway injects one `RAILWAY_SERVICE_<NAME>_URL` per service with a public
  // domain into EVERY service in the environment. It is generated, not stored:
  // `variableDelete` returns true and the value is present again on the next
  // read, verified against the live API on 2026-08-31. So an allowlist that
  // omits these names cannot be satisfied on Railway at all — the gateway
  // refuses to boot, permanently, for a reason no operator action can clear.
  //
  // That is exactly what happened. `google-egress-gateway` failed with
  // "forbidden variable RAILWAY_SERVICE_GBP_SANDBOX_URL" on the first build it
  // had ever done from git. Both AI sidecars already allow these three
  // (ai-egress-gateway/environment.ts:38-40) and boot fine in the same
  // environment; the Google pair simply never got them.
  //
  // This admits three sibling hostnames, not secrets. The isolation this gate
  // exists for is intact and provably so: the rejection list above still
  // refuses OPENAI_API_KEY, which was found set on this very service.
  it.each([
    'RAILWAY_SERVICE_WEB_URL',
    'RAILWAY_SERVICE_GBP_SANDBOX_URL',
    'RAILWAY_SERVICE_MAIL_SANDBOX_URL',
  ])('admits the platform-injected %s, which cannot be removed', (name) => {
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        [name]: 'some-service.up.railway.app',
      }),
    ).not.toThrow()
  })

  it('still refuses a real secret alongside the platform-injected URLs', () => {
    expect(() =>
      assertGoogleGatewayEnvironmentIsIsolated({
        RAILWAY_SERVICE_WEB_URL: 'web.up.railway.app',
        OPENAI_API_KEY: 'secret',
      }),
    ).toThrow('OPENAI_API_KEY')
  })

  it('accepts only the separated health/mTLS ports and the single beta cell', () => {
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({ ...environment(), PORT: '8443' }),
    ).toThrow('Google gateway bind address is invalid')
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        INTERNAL_MTLS_PORT: '8080',
      }),
    ).toThrow('Google gateway bind address is invalid')
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        PROCESSING_CELL: 'global',
      }),
    ).toThrow('Google gateway processing cell is invalid')
    expect(() =>
      assertGoogleGatewayRequiredEnvironment({
        ...environment(),
        SENTRY_DSN: 'https://public@ingest.de.sentry.io/1',
        SENTRY_TRACES_SAMPLE_RATE: '0.1',
      }),
    ).not.toThrow()
  })

  it('keeps the simulator contract local-only', () => {
    const local = {
      ...environment(),
      GOOGLE_PROVIDER_ROUTE_PROFILE: 'local_sandbox',
      GOOGLE_EXECUTION_ADMISSION_ORIGIN: 'https://google-execution-admission:8443',
      GOOGLE_PROVIDER_SIMULATOR_ORIGIN: 'https://google-provider-simulator:8443',
    }
    expect(() => assertGoogleGatewayRequiredLocalEnvironment(local)).not.toThrow()
    expect(() => assertGoogleGatewayRequiredProductionEnvironment(local)).toThrow(
      'GOOGLE_PROVIDER_SIMULATOR_ORIGIN',
    )
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
