import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES,
  assertGoogleAdmissionEnvironmentIsIsolated,
  assertGoogleAdmissionRequiredEnvironment,
} from './environment'

function environment(): Record<string, string> {
  const values: Record<string, string> = {
    ...Object.fromEntries(
      GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES.map((name) => [name, 'masked']),
    ),
    HOST: '0.0.0.0',
    PORT: '8080',
    INTERNAL_MTLS_PORT: '8443',
    PROCESSING_CELL: 'us',
    RELEASE_SHA: 'a'.repeat(40),
    IMAGE_SOURCE_REVISION: 'a'.repeat(40),
  }
  delete values.GOOGLE_INTERNAL_MTLS_CA_PATH
  delete values.GOOGLE_INTERNAL_MTLS_CERT_PATH
  delete values.GOOGLE_INTERNAL_MTLS_KEY_PATH
  return values
}

function composeEnvironmentNames(): string[] {
  const source = readFileSync(resolve(process.cwd(), 'compose.local.yml'), 'utf8')
  const block = source.slice(
    source.indexOf('  google-execution-admission:'),
    source.indexOf('  google-egress-gateway:'),
  )
  const values = block.slice(block.indexOf('    environment:'))
  return [...values.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gmu)].map((match) => match[1] ?? '')
}

describe('Google execution-admission startup isolation', () => {
  it.each([
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_API_KEY',
    'GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'RESEND_API_KEY',
    'RAILWAY_TOKEN',
    'POSTGRES_PASSWORD',
    'UNKNOWN_FLAG',
    'database_url',
  ])('rejects every unowned or noncanonical %s', (name) => {
    expect(() => assertGoogleAdmissionEnvironmentIsIsolated({ [name]: '' })).toThrow(name)
  })

  it('requires one concrete release identity and the private bind contract', () => {
    expect(() => assertGoogleAdmissionRequiredEnvironment(environment())).not.toThrow()
    expect(() =>
      assertGoogleAdmissionRequiredEnvironment({
        ...environment(),
        IMAGE_SOURCE_REVISION: 'b'.repeat(40),
      }),
    ).toThrow('RELEASE_SHA does not match')
    expect(() =>
      assertGoogleAdmissionRequiredEnvironment({ ...environment(), PORT: '8444' }),
    ).toThrow('Google admission bind address is invalid')
    expect(() =>
      assertGoogleAdmissionRequiredEnvironment({
        ...environment(),
        INTERNAL_MTLS_PORT: '8080',
      }),
    ).toThrow('Google admission bind address is invalid')
    expect(() =>
      assertGoogleAdmissionRequiredEnvironment({
        ...environment(),
        PROCESSING_CELL: 'europe',
      }),
    ).toThrow('Google admission processing cell is invalid')
  })

  it('accepts documented Node and Railway runtime metadata', () => {
    expect(() =>
      assertGoogleAdmissionRequiredEnvironment({
        ...environment(),
        HOME: '/home/node',
        HOSTNAME: 'container',
        NODE_ENV: 'production',
        NODE_VERSION: '22.23.2',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        PWD: '/app',
        SHLVL: '1',
        RAILWAY_DEPLOYMENT_ID: 'deployment',
        RAILWAY_ENVIRONMENT_ID: 'environment',
        RAILWAY_ENVIRONMENT_NAME: 'cell-us',
        RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
        RAILWAY_PRIVATE_DOMAIN: 'google-execution-admission.railway.internal',
        RAILWAY_PROJECT_ID: 'project',
        RAILWAY_REPLICA_ID: 'replica',
        RAILWAY_REPLICA_REGION: 'europe-west4',
        RAILWAY_SERVICE_ID: 'service',
        RAILWAY_SERVICE_NAME: 'google-execution-admission',
        SENTRY_DSN: 'https://public@ingest.de.sentry.io/1',
        SENTRY_TRACES_SAMPLE_RATE: '0.1',
      }),
    ).not.toThrow()
  })

  it('keeps the compose inventory equal to the process-owned names', () => {
    const names = composeEnvironmentNames()
    expect(names).toContain('GOOGLE_INTERNAL_MTLS_CA_PATH')
    expect(names).toContain('GOOGLE_INTERNAL_MTLS_CERT_PATH')
    expect(names).toContain('GOOGLE_INTERNAL_MTLS_KEY_PATH')
    expect(names).not.toContain('GOOGLE_INTERNAL_MTLS_CA_B64')
    expect(names).not.toContain('GOOGLE_INTERNAL_MTLS_CERT_B64')
    expect(names).not.toContain('GOOGLE_INTERNAL_MTLS_KEY_B64')
    expect(names.sort()).toEqual(
      [
        ...GOOGLE_ADMISSION_REQUIRED_ENVIRONMENT_NAMES.filter(
          (name) =>
            name !== 'IMAGE_SOURCE_REVISION' && !name.startsWith('GOOGLE_INTERNAL_MTLS_'),
        ),
        'GOOGLE_INTERNAL_MTLS_CA_PATH',
        'GOOGLE_INTERNAL_MTLS_CERT_PATH',
        'GOOGLE_INTERNAL_MTLS_KEY_PATH',
      ].sort(),
    )
  })

  it('checks isolation before construction and keeps build tooling out of runtime', () => {
    const index = readFileSync(
      resolve(process.cwd(), 'services/google-execution-admission/index.ts'),
      'utf8',
    )
    const dockerfile = readFileSync(
      resolve(process.cwd(), 'Dockerfile.google-execution-admission'),
      'utf8',
    )

    expect(
      index.indexOf('assertGoogleAdmissionRequiredEnvironment(process.env)'),
    ).toBeLessThan(index.indexOf('new Pool({'))
    expect(index).toMatch(/consumeGoogleAdmissionRuntimeSecrets\(\s*process\.env/u)
    expect(index).not.toContain("requiredEnv('DATABASE_URL')")
    expect(index).toContain('grantKeyring.dispose()')
    expect(index.indexOf('authority.readiness()')).toBeGreaterThan(0)
    expect(index.indexOf('authority.readiness()')).toBeLessThan(
      index.indexOf('server.listen('),
    )
    expect(dockerfile).toContain(
      'FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS runtime',
    )
    expect(dockerfile).toContain('/usr/local/bin/pnpm')
  })
})
