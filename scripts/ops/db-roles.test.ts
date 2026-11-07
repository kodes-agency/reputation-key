import { Client, type QueryResult } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDatabaseRoleStore,
  inspectRoleSafety,
  parseDatabaseRoleArgs,
  runDatabaseRoles,
  type DatabaseRoleStore,
  type RoleSafetySnapshot,
} from './db-roles'

afterEach(() => vi.restoreAllMocks())

const safeRole = (
  name: 'repkey_app' | 'repkey_system',
): RoleSafetySnapshot['roles'][number] => ({
  name,
  superuser: false,
  bypassRls: name === 'repkey_system',
  createRole: false,
  createDb: false,
  replication: false,
  ownsObjects: false,
  hasMemberships: false,
  createObjects: false,
  unsafeTablePrivileges: false,
  grantOptions: false,
})

function safeSnapshot(): RoleSafetySnapshot {
  return {
    ownerExists: true,
    ownerCanMigrate: true,
    ownerIsRuntimeRole: false,
    roles: [safeRole('repkey_app'), safeRole('repkey_system')],
    publicSchemaWritable: false,
    publicDatabaseCreate: false,
    unsafeDefaultPrivileges: false,
    grantsReady: true,
  }
}

function storeReturning(...snapshots: RoleSafetySnapshot[]) {
  const inspect = vi.fn<DatabaseRoleStore['inspect']>()
  for (const snapshot of snapshots) inspect.mockResolvedValueOnce(snapshot)
  return {
    inspect,
    provision: vi.fn<DatabaseRoleStore['provision']>().mockResolvedValue(undefined),
  }
}

describe('database role arguments', () => {
  it('defaults to reporting without granting privileges', () => {
    expect(parseDatabaseRoleArgs(['--owner', 'migration_owner'])).toEqual({
      help: false,
      apply: false,
      owner: 'migration_owner',
    })
  })

  it('allows help without a database owner', () => {
    expect(parseDatabaseRoleArgs(['--help'])).toEqual({
      help: true,
      apply: false,
      owner: undefined,
    })
  })

  it('requires an explicit apply flag', () => {
    expect(parseDatabaseRoleArgs(['--apply', '--owner', 'migration_owner'])).toEqual({
      help: false,
      apply: true,
      owner: 'migration_owner',
    })
  })

  it.each([
    { argv: [], error: 'A migration owner is required' },
    { argv: ['--apply'], error: 'A migration owner is required' },
    { argv: ['--owner'], error: 'Missing migration owner' },
    {
      argv: ['--owner', 'migration_owner', '--unknown'],
      error: 'Unknown or repeated argument',
    },
    {
      argv: ['--owner', 'migration_owner', '--apply', '--apply'],
      error: 'Unknown or repeated argument',
    },
    {
      argv: ['--owner', 'migration_owner', '--owner', 'other_owner'],
      error: 'Unknown or repeated argument',
    },
    {
      argv: ['--owner', 'repkey_app'],
      error: 'Migration owner must differ from the runtime roles',
    },
    {
      argv: ['--owner', 'repkey_system'],
      error: 'Migration owner must differ from the runtime roles',
    },
    { argv: ['--owner', ''], error: 'Missing migration owner' },
    {
      argv: ['--owner', 'Owner'],
      error: 'Migration owner must be a lowercase PostgreSQL role name',
    },
    {
      argv: ['--owner', 'a'.repeat(64)],
      error: 'Migration owner must be a lowercase PostgreSQL role name',
    },
    {
      argv: ['--owner', 'owner; grant all'],
      error: 'Migration owner must be a lowercase PostgreSQL role name',
    },
    {
      argv: ['--owner', 'owner"'],
      error: 'Migration owner must be a lowercase PostgreSQL role name',
    },
  ])('refuses ambiguous or unsafe arguments: $argv', ({ argv, error }) => {
    expect(() => parseDatabaseRoleArgs(argv)).toThrow(error)
  })
})

describe('database role safety', () => {
  it('accepts a separate migration owner and restricted runtime roles', () => {
    expect(inspectRoleSafety(safeSnapshot())).toEqual([])
  })

  it('allows absent runtime roles to be provisioned', () => {
    expect(inspectRoleSafety({ ...safeSnapshot(), roles: [] })).toEqual([])
  })

  it.each([
    'superuser',
    'createRole',
    'createDb',
    'replication',
    'ownsObjects',
    'hasMemberships',
    'createObjects',
    'unsafeTablePrivileges',
    'grantOptions',
  ] as const)('refuses %s on either runtime role', (privilege) => {
    for (const name of ['repkey_app', 'repkey_system'] as const) {
      const snapshot = {
        ...safeSnapshot(),
        roles: [{ ...safeRole(name), [privilege]: true }],
      }
      expect(inspectRoleSafety(snapshot).length).toBeGreaterThan(0)
    }
  })

  it('refuses application RLS bypass', () => {
    const snapshot = {
      ...safeSnapshot(),
      roles: [{ ...safeRole('repkey_app'), bypassRls: true }],
    }
    expect(inspectRoleSafety(snapshot).length).toBeGreaterThan(0)
  })

  it('refuses a system role without its required RLS bypass', () => {
    const snapshot = {
      ...safeSnapshot(),
      roles: [{ ...safeRole('repkey_system'), bypassRls: false }],
    }
    expect(inspectRoleSafety(snapshot).length).toBeGreaterThan(0)
  })

  it.each([
    { ownerExists: false },
    { ownerCanMigrate: false },
    { ownerIsRuntimeRole: true },
    { publicSchemaWritable: true },
    { publicDatabaseCreate: true },
    { unsafeDefaultPrivileges: true },
  ])('refuses an unsafe owner or PUBLIC privilege: %j', (unsafe) => {
    expect(inspectRoleSafety({ ...safeSnapshot(), ...unsafe }).length).toBeGreaterThan(0)
  })
})

describe('database role provisioning', () => {
  it('reports missing roles without writing', async () => {
    const store = storeReturning({ ...safeSnapshot(), roles: [] })
    await expect(
      runDatabaseRoles({ apply: false, owner: 'migration_owner', store }),
    ).resolves.toEqual({ state: 'missing', missing: ['repkey_app', 'repkey_system'] })
    expect(store.provision).not.toHaveBeenCalled()
    expect(store.inspect).toHaveBeenCalledExactlyOnceWith('migration_owner')
  })

  it('reports ready roles without refreshing grants', async () => {
    const store = storeReturning(safeSnapshot())
    await expect(
      runDatabaseRoles({ apply: false, owner: 'migration_owner', store }),
    ).resolves.toEqual({ state: 'ready', missing: [] })
    expect(store.provision).not.toHaveBeenCalled()
  })

  it('reports missing grants even when both roles exist', async () => {
    const store = storeReturning({ ...safeSnapshot(), grantsReady: false })
    await expect(
      runDatabaseRoles({ apply: false, owner: 'migration_owner', store }),
    ).resolves.toEqual({ state: 'missing', missing: [] })
    expect(store.provision).not.toHaveBeenCalled()
  })

  it('provisions only the missing role then reads back safety', async () => {
    const before = { ...safeSnapshot(), roles: [safeRole('repkey_app')] }
    const store = storeReturning(before, safeSnapshot())
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).resolves.toEqual({ state: 'applied', missing: [] })
    expect(store.provision).toHaveBeenCalledExactlyOnceWith('migration_owner', [
      'repkey_system',
    ])
    expect(store.inspect).toHaveBeenCalledTimes(2)
    expect(store.provision.mock.invocationCallOrder[0]).toBeGreaterThan(
      store.inspect.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(store.provision.mock.invocationCallOrder[0]).toBeLessThan(
      store.inspect.mock.invocationCallOrder[1] ?? -Infinity,
    )
  })

  it('refreshes current and future object grants even when both roles exist', async () => {
    const store = storeReturning(safeSnapshot(), safeSnapshot())
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).resolves.toEqual({ state: 'applied', missing: [] })
    expect(store.provision).toHaveBeenCalledExactlyOnceWith('migration_owner', [])
    expect(store.inspect).toHaveBeenCalledTimes(2)
  })

  it('refuses unsafe existing roles before any write', async () => {
    const snapshot = {
      ...safeSnapshot(),
      roles: [{ ...safeRole('repkey_app'), hasMemberships: true }],
    }
    const store = storeReturning(snapshot)
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).rejects.toThrow('repkey_app has ownership or elevated privileges')
    expect(store.provision).not.toHaveBeenCalled()
  })

  it('refuses unsafe reports without applying repairs', async () => {
    const store = storeReturning({ ...safeSnapshot(), publicSchemaWritable: true })
    await expect(
      runDatabaseRoles({ apply: false, owner: 'migration_owner', store }),
    ).rejects.toThrow('PUBLIC permits object creation; review those grants first')
    expect(store.provision).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'refuses unsafe default privileges with apply=%s',
    async (apply) => {
      const store = storeReturning(
        { ...safeSnapshot(), unsafeDefaultPrivileges: true, roles: [] },
        safeSnapshot(),
      )
      await expect(
        runDatabaseRoles({ apply, owner: 'migration_owner', store }),
      ).rejects.toThrow('Unsafe default privileges; review those grants first')
      expect(store.provision).not.toHaveBeenCalled()
    },
  )

  it('does not claim success when a required role is still absent', async () => {
    const missing = { ...safeSnapshot(), roles: [] }
    const store = storeReturning(missing, missing)
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).rejects.toThrow('Database role grants failed verification')
  })

  it('does not claim success when the resulting role is unsafe', async () => {
    const after = {
      ...safeSnapshot(),
      roles: [{ ...safeRole('repkey_app'), bypassRls: true }],
    }
    const store = storeReturning({ ...safeSnapshot(), roles: [] }, after)
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).rejects.toThrow('repkey_app has an unexpected row-security bypass setting')
  })

  it('does not claim success when object grants were not retained', async () => {
    const store = storeReturning(safeSnapshot(), {
      ...safeSnapshot(),
      grantsReady: false,
    })
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).rejects.toThrow('Database role grants failed verification')
  })

  it('propagates failed provisioning without reporting success', async () => {
    const store = storeReturning({ ...safeSnapshot(), roles: [] })
    const failure = new Error('database refused role creation')
    store.provision.mockRejectedValueOnce(failure)
    await expect(
      runDatabaseRoles({ apply: true, owner: 'migration_owner', store }),
    ).rejects.toBe(failure)
    expect(store.inspect).toHaveBeenCalledTimes(1)
  })
})

function queryResult(rows: ReadonlyArray<Record<string, unknown>> = []): QueryResult {
  return { rows: [...rows], rowCount: rows.length, fields: [], command: 'SELECT', oid: 0 }
}

function inspectionResults(snapshot: RoleSafetySnapshot): QueryResult[] {
  return [
    queryResult(snapshot.roles),
    queryResult([snapshot]),
    queryResult([{ ready: snapshot.grantsReady }]),
  ]
}

function roleClient(
  reads: QueryResult[],
  grantFailure?: Error,
): { client: Client; statements: string[] } {
  const client = new Client()
  const statements: string[] = []
  vi.spyOn(client, 'query').mockImplementation(async (text) => {
    const statement = text.replace(/\s+/g, ' ').trim()
    statements.push(statement)
    if (grantFailure && /^GRANT\b/.test(statement)) throw grantFailure
    if (!/^SELECT\b/.test(statement)) return queryResult()
    const response = reads.shift()
    if (!response) throw new Error('Unexpected catalog read')
    return response
  })
  return { client, statements }
}

describe('database role transaction', () => {
  it('creates missing roles with distinct bypass settings and no administrative powers', async () => {
    const missing = { ...safeSnapshot(), roles: [], grantsReady: false }
    const { client, statements } = roleClient([
      queryResult(),
      queryResult(),
      queryResult([missing]),
      queryResult([{ name: 'test_database' }]),
      ...inspectionResults(safeSnapshot()),
    ])
    await expect(
      createDatabaseRoleStore(client).provision('migration_owner', [
        'repkey_app',
        'repkey_system',
      ]),
    ).resolves.toBeUndefined()
    const creates = statements.filter((sql) => /^CREATE ROLE\b/.test(sql))
    expect(creates).toHaveLength(2)
    for (const [name, bypass] of [
      ['repkey_app', 'NOBYPASSRLS'],
      ['repkey_system', 'BYPASSRLS'],
    ]) {
      const statement = creates.find((sql) => sql.startsWith(`CREATE ROLE ${name} `))
      expect(statement?.split(' ')).toEqual(
        expect.arrayContaining([
          'LOGIN',
          'NOINHERIT',
          'NOSUPERUSER',
          'NOCREATEROLE',
          'NOCREATEDB',
          'NOREPLICATION',
          bypass,
        ]),
      )
    }
    expect(statements.at(-1)).toBe('COMMIT')
    expect(statements).not.toContain('ROLLBACK')
  })

  it('rolls back a failed grant without committing partial changes', async () => {
    const failure = new Error('grant refused')
    const { client, statements } = roleClient(
      [
        queryResult(),
        ...inspectionResults(safeSnapshot()),
        queryResult([{ name: 'test_database' }]),
      ],
      failure,
    )
    await expect(
      createDatabaseRoleStore(client).provision('migration_owner', []),
    ).rejects.toBe(failure)
    expect(statements[0]).toBe('BEGIN')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })

  it('rechecks safety under the lock before creating roles or granting anything', async () => {
    const unsafe = {
      ...safeSnapshot(),
      roles: [{ ...safeRole('repkey_app'), createObjects: true }],
    }
    // An absent system role means readiness is not queried during inspection.
    const { client, statements } = roleClient([
      queryResult(),
      queryResult(unsafe.roles),
      queryResult([unsafe]),
    ])
    await expect(
      createDatabaseRoleStore(client).provision('migration_owner', ['repkey_system']),
    ).rejects.toThrow('repkey_app has ownership or elevated privileges')
    expect(statements.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true)
    expect(
      statements.filter((sql) =>
        /^(?:CREATE ROLE|GRANT|ALTER DEFAULT PRIVILEGES)\b/.test(sql),
      ),
    ).toEqual([])
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })

  it('rolls back grants when their read-back fails readiness', async () => {
    const { client, statements } = roleClient([
      queryResult(),
      ...inspectionResults(safeSnapshot()),
      queryResult([{ name: 'test_database' }]),
      ...inspectionResults({ ...safeSnapshot(), grantsReady: false }),
    ])
    await expect(
      createDatabaseRoleStore(client).provision('migration_owner', []),
    ).rejects.toThrow('Database role grants failed verification')
    expect(statements.some((sql) => /^GRANT\b/.test(sql))).toBe(true)
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })

  it('refreshes current and future object grants and commits verified roles', async () => {
    const { client, statements } = roleClient([
      queryResult(),
      ...inspectionResults(safeSnapshot()),
      queryResult([{ name: 'test_database' }]),
      ...inspectionResults(safeSnapshot()),
    ])
    await expect(
      createDatabaseRoleStore(client).provision('migration_owner', []),
    ).resolves.toBeUndefined()
    expect(statements[0]).toBe('BEGIN')
    expect(statements.at(-1)).toBe('COMMIT')
    expect(statements).not.toContain('ROLLBACK')
    expect(statements.some((sql) => /^CREATE ROLE\b/.test(sql))).toBe(false)
    expect(statements.some((sql) => /^GRANT .* ON ALL TABLES\b/.test(sql))).toBe(true)
    expect(statements.some((sql) => /^GRANT .* ON ALL SEQUENCES\b/.test(sql))).toBe(true)
    expect(
      statements.some((sql) => /^ALTER DEFAULT PRIVILEGES .* ON TABLES\b/.test(sql)),
    ).toBe(true)
    expect(
      statements.some((sql) => /^ALTER DEFAULT PRIVILEGES .* ON SEQUENCES\b/.test(sql)),
    ).toBe(true)
  })
})
