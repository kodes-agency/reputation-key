import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('AI admission database transport architecture', () => {
  it('uses a dedicated CA, verified TLS pool, and live pg_stat_ssl readiness evidence', () => {
    const index = source('services/ai-execution-admission/index.ts')
    const tls = source('services/ai-execution-admission/database-tls.ts')
    const authority = source(
      'services/ai-execution-admission/postgres-admission-authority.ts',
    )

    expect(index).toContain('AI_CONTROL_DATABASE_CA_B64')
    expect(index).toContain('ssl: databaseTls.ssl')
    expect(tls).toContain('rejectUnauthorized: true')
    expect(authority).toContain('pg_catalog.pg_stat_ssl')
    expect(authority).toContain('connection.ssl')
  })

  it('keeps the local TLS endpoint on admission-data and keeps Redis out', () => {
    const compose = source('compose.local.yml')
    const postgres = compose.slice(
      compose.indexOf('  postgres:'),
      compose.indexOf('  redis:'),
    )
    const redis = compose.slice(
      compose.indexOf('  redis:'),
      compose.indexOf('  provider-redis:'),
    )
    const admission = compose.slice(
      compose.indexOf('  ai-execution-admission:'),
      compose.indexOf('  ai-egress-gateway:'),
    )

    expect(postgres).toContain('ssl=on')
    expect(postgres).toContain('aliases: [ai-control-postgres]')
    expect(admission).toContain('@ai-control-postgres:5432/')
    expect(admission).toContain('AI_CONTROL_DATABASE_CA_B64:')
    expect(redis).not.toContain('admission-data')
  })

  it('does not reuse the AI service mTLS CA as the database trust root', () => {
    const stack = source('scripts/local-stack/stack.ts')
    expect(stack).toContain("encoded('control-db-ca.crt')")
    expect(stack).toContain("encoded('ca.crt')")
    expect(stack).toContain('/CN=repkey-local-ai-control-database-ca')
    expect(stack).toContain('/CN=repkey-local-ai-internal-ca')
  })
})
