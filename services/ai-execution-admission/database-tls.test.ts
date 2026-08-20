import { describe, expect, it } from 'vitest'
import { loadAiControlDatabaseTlsConfiguration } from './database-tls'

const certificate = `-----BEGIN CERTIFICATE-----\n${Buffer.from('repkey-ai-control-db-ca').toString('base64')}\n-----END CERTIFICATE-----\n`
const encodedCertificate = Buffer.from(certificate, 'utf8').toString('base64')

describe('AI admission control-database TLS', () => {
  it('constructs certificate-verified TLS without changing the database authority hostname', () => {
    const loaded = loadAiControlDatabaseTlsConfiguration({
      connectionString:
        'postgresql://repkey_ai_admission_local:secret@postgres:5432/repkey',
      caBase64: encodedCertificate,
    })
    expect(loaded.connectionString).toBe(
      'postgresql://repkey_ai_admission_local:secret@postgres:5432/repkey',
    )
    expect(loaded.serverName).toBe('postgres')
    expect(loaded.ssl.rejectUnauthorized).toBe(true)
    expect(loaded.ssl.ca.equals(Buffer.from(certificate, 'utf8'))).toBe(true)
    loaded.dispose()
    expect(loaded.ssl.ca.every((byte) => byte === 0)).toBe(true)
  })

  it.each([
    'postgresql://role:secret@127.0.0.1:5432/repkey',
    'postgresql://role:secret@[::1]:5432/repkey',
    'postgresql://role:secret@postgres:5432/repkey?sslmode=require',
    'postgresql://role:secret@postgres:5432/repkey?sslmode=verify-full',
    'postgresql://role:secret@postgres:5432/repkey#fragment',
    'postgresql://role:secret@POSTGRES:5432/repkey',
    'http://role:secret@postgres:5432/repkey',
  ])(
    'rejects an authority that can weaken or bypass hostname verification: %s',
    (connectionString) => {
      expect(() =>
        loadAiControlDatabaseTlsConfiguration({
          connectionString,
          caBase64: encodedCertificate,
        }),
      ).toThrow('AI admission control database TLS configuration is invalid')
    },
  )

  it.each([
    '',
    'not-base64',
    Buffer.alloc(1024 * 1024 + 1).toString('base64'),
    Buffer.from('not a PEM certificate').toString('base64'),
  ])('rejects malformed or unbounded database CA material', (caBase64) => {
    expect(() =>
      loadAiControlDatabaseTlsConfiguration({
        connectionString: 'postgresql://role:secret@postgres:5432/repkey',
        caBase64,
      }),
    ).toThrow('AI admission control database TLS configuration is invalid')
  })
})
