import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Google admission database transport architecture', () => {
  it('uses an explicit CA, a verified TLS pool, and live pg_stat_ssl readiness evidence', () => {
    const index = source('services/google-execution-admission/index.ts')
    const authority = source(
      'services/google-execution-admission/postgres-permit-authority.ts',
    )
    const tls = source('services/postgres-database-tls.ts')

    expect(index).toContain('GOOGLE_ADMISSION_DATABASE_CA_B64')
    expect(index).toContain('ssl: databaseTls.ssl')
    expect(authority).toContain('pg_catalog.pg_stat_ssl')
    expect(tls).toContain('rejectUnauthorized: true')
  })

  it('gives the local database certificate every hostname used by admission services', () => {
    const stack = source('scripts/local-stack/stack.ts')
    const compose = source('compose.local.yml')
    const googleAdmission = compose.slice(
      compose.indexOf('  google-execution-admission:'),
      compose.indexOf('  google-egress-gateway:'),
    )

    expect(stack).toContain('subjectAltName=DNS:ai-control-postgres,DNS:postgres')
    expect(googleAdmission).toContain('GOOGLE_ADMISSION_DATABASE_CA_B64:')
  })
})
