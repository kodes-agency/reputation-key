// Fence proving a test/setup run can never target the database a developer has
// configured for ordinary development. See configured-database-fence.ts for why.

import { describe, expect, it } from 'vitest'
import {
  CONFIGURED_DATABASE_ENV_FILES,
  CONFIGURED_DATABASE_ENV_KEYS,
  assertNotConfiguredDatabase,
  databaseIdentity,
  parseConfiguredDatabaseIdentities,
  sameDatabaseIdentity,
} from './configured-database-fence'
import { DEFAULT_TEST_DATABASE_URL } from './test-environment'

describe('databaseIdentity', () => {
  it('normalizes host case and defaults the port', () => {
    expect(databaseIdentity('postgresql://u:p@LocalHost/repkey_dev')).toEqual({
      host: 'localhost',
      port: '5432',
      database: 'repkey_dev',
    })
  })

  it('keeps an explicit port and ignores credentials and query parameters', () => {
    expect(
      databaseIdentity('postgresql://someone:secret@127.0.0.1:5433/repkey_dev?ssl=true'),
    ).toEqual({ host: '127.0.0.1', port: '5433', database: 'repkey_dev' })
  })

  it('decodes a percent-encoded database name', () => {
    expect(databaseIdentity('postgresql://u:p@localhost/rep%20key')?.database).toBe(
      'rep key',
    )
  })

  it('returns null for a value that is not a database URL', () => {
    expect(databaseIdentity('not a url')).toBeNull()
    expect(databaseIdentity('')).toBeNull()
  })
})

describe('sameDatabaseIdentity', () => {
  it('treats the documented localhost aliases as one host', () => {
    const left = databaseIdentity('postgresql://u:p@localhost:5432/repkey_dev')!
    const right = databaseIdentity('postgresql://u:p@127.0.0.1:5432/repkey_dev')!
    expect(sameDatabaseIdentity(left, right)).toBe(true)
  })

  it('does not conflate different database names on the same host', () => {
    const left = databaseIdentity('postgresql://u:p@localhost/repkey_dev')!
    const right = databaseIdentity('postgresql://u:p@localhost/repkey_scratch')!
    expect(sameDatabaseIdentity(left, right)).toBe(false)
  })

  it('does not conflate the same database name on different ports', () => {
    const left = databaseIdentity('postgresql://u:p@localhost:5432/repkey_dev')!
    const right = databaseIdentity('postgresql://u:p@localhost:5433/repkey_dev')!
    expect(sameDatabaseIdentity(left, right)).toBe(false)
  })
})

describe('parseConfiguredDatabaseIdentities', () => {
  it('reads every configured connection key, tolerating export and quoting', () => {
    const identities = parseConfiguredDatabaseIdentities([
      [
        '# a comment',
        'export DATABASE_URL="postgresql://u:p@localhost:5432/repkey_dev"',
        "DATABASE_URL_POOLER='postgresql://u:p@localhost:5432/repkey_pooled'",
        'UNRELATED=postgresql://u:p@localhost:5432/other',
        '',
      ].join('\n'),
    ])
    expect(identities.map((identity) => identity.database).sort()).toEqual([
      'repkey_dev',
      'repkey_pooled',
    ])
  })

  it('ignores a commented-out connection string', () => {
    const identities = parseConfiguredDatabaseIdentities([
      '# DATABASE_URL=postgresql://u:p@neon.example/neondb\nDATABASE_URL=postgresql://u:p@localhost/repkey_dev',
    ])
    expect(identities).toHaveLength(1)
    expect(identities[0]!.database).toBe('repkey_dev')
  })

  it('never surfaces the canonical disposable scratch database as configured', () => {
    const identities = parseConfiguredDatabaseIdentities([
      `DATABASE_URL=${DEFAULT_TEST_DATABASE_URL}`,
    ])
    expect(identities).toEqual([])
  })

  it('deduplicates the same target declared in several files', () => {
    const identities = parseConfiguredDatabaseIdentities([
      'DATABASE_URL=postgresql://u:p@localhost:5432/repkey_dev',
      'DATABASE_URL=postgresql://other:pass@127.0.0.1:5432/repkey_dev',
    ])
    expect(identities).toHaveLength(1)
  })

  it('returns nothing for absent or empty files', () => {
    expect(parseConfiguredDatabaseIdentities([])).toEqual([])
    expect(parseConfiguredDatabaseIdentities(['', '   '])).toEqual([])
  })
})

describe('assertNotConfiguredDatabase', () => {
  const configured = parseConfiguredDatabaseIdentities([
    'DATABASE_URL=postgresql://u:p@localhost:5432/repkey_dev',
  ])

  it('refuses the configured development database', () => {
    expect(() =>
      assertNotConfiguredDatabase(
        'postgresql://test:test@localhost:5432/repkey_dev',
        configured,
      ),
    ).toThrow(/configured for development/i)
  })

  it('refuses it through a localhost alias too', () => {
    expect(() =>
      assertNotConfiguredDatabase(
        'postgresql://test:test@127.0.0.1:5432/repkey_dev',
        configured,
      ),
    ).toThrow(/configured for development/i)
  })

  it('reports a distinguishable error code and never leaks the password', () => {
    let thrown: unknown
    try {
      assertNotConfiguredDatabase(
        'postgresql://test:hunter2@localhost:5432/repkey_dev',
        configured,
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'configured_development_database' })
    expect(String((thrown as Error).message)).not.toContain('hunter2')
  })

  it('allows a disposable scratch database on the same host', () => {
    expect(() =>
      assertNotConfiguredDatabase(
        'postgresql://test:test@localhost:5432/repkey_scratch_20260828',
        configured,
      ),
    ).not.toThrow()
  })

  it('cannot be overridden by an environment variable', () => {
    const previous = process.env.ALLOW_REMOTE_TEST_DB
    process.env.ALLOW_REMOTE_TEST_DB = '1'
    try {
      expect(() =>
        assertNotConfiguredDatabase(
          'postgresql://test:test@localhost:5432/repkey_dev',
          configured,
        ),
      ).toThrow()
    } finally {
      if (previous === undefined) delete process.env.ALLOW_REMOTE_TEST_DB
      else process.env.ALLOW_REMOTE_TEST_DB = previous
    }
  })

  it('is a no-op when nothing is configured', () => {
    expect(() =>
      assertNotConfiguredDatabase('postgresql://test:test@localhost:5432/anything', []),
    ).not.toThrow()
  })
})

describe('fence coverage', () => {
  it('scans the developer env files that can carry a connection string', () => {
    expect([...CONFIGURED_DATABASE_ENV_FILES]).toEqual([
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
    ])
  })

  it('scans every connection key the runtime honours', () => {
    expect([...CONFIGURED_DATABASE_ENV_KEYS]).toEqual([
      'DATABASE_URL',
      'DATABASE_URL_POOLER',
      'DIRECT_DATABASE_URL',
    ])
  })
})
