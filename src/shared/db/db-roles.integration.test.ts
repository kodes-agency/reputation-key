import { randomUUID } from 'node:crypto'
import { Client, type PoolClient } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseRoleStore, runDatabaseRoles } from '../../../scripts/ops/db-roles'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const runtimeRoles = ['repkey_app', 'repkey_system'] as const
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

describe('database role command through PostgreSQL', () => {
  let maintenance: TestLease
  let lock: PoolClient | undefined
  let isolatedRoles = false
  let database: string | undefined
  let owner: string
  let otherCreator: string | undefined
  let client: Client | undefined
  let observer: Client | undefined

  beforeAll(async () => {
    maintenance = await acquireTestLease(getEnv().DATABASE_URL)
    lock = await maintenance.pool.connect()
    // Roles are cluster-wide even though each test owns a separate database.
    await lock.query("SELECT pg_advisory_lock(hashtext('repkey.database-roles-tests'))")
    const existing = await lock.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('repkey_app', 'repkey_system')",
    )
    expect(existing.rows, 'requires a disposable cluster without runtime roles').toEqual(
      [],
    )
    isolatedRoles = true
  })

  beforeEach(async () => {
    const id = randomUUID().replaceAll('-', '')
    owner = `role_owner_${id}`
    database = `test_roles_${id}-quoted`
    await maintenance.pool.query(`CREATE ROLE ${quote(owner)} NOLOGIN`)
    await maintenance.pool.query(
      `CREATE DATABASE ${quote(database)} OWNER ${quote(owner)}`,
    )
    const url = new URL(getEnv().DATABASE_URL)
    url.pathname = `/${database}`
    client = new Client({ connectionString: url.toString() })
    observer = new Client({ connectionString: url.toString() })
    await client.connect()
    await observer.connect()
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
    await asRole(
      owner,
      `CREATE TABLE records (id serial PRIMARY KEY, value integer);
      INSERT INTO records (value) VALUES (7)`,
    )
  })

  afterEach(async () => {
    await client?.end()
    await observer?.end()
    client = undefined
    observer = undefined
    if (database) await maintenance.pool.query(`DROP DATABASE ${quote(database)}`)
    database = undefined
    if (isolatedRoles) {
      await maintenance.pool.query('DROP ROLE IF EXISTS repkey_app, repkey_system')
      if (otherCreator) await maintenance.pool.query(`DROP ROLE ${quote(otherCreator)}`)
      if (owner) await maintenance.pool.query(`DROP ROLE ${quote(owner)}`)
    }
    otherCreator = undefined
  })

  afterAll(async () => {
    if (lock) {
      await lock.query(
        "SELECT pg_advisory_unlock(hashtext('repkey.database-roles-tests'))",
      )
      lock.release()
    }
    await maintenance?.release()
  })

  function command(apply: boolean) {
    if (!client) throw new Error('Test database is not connected')
    return runDatabaseRoles({ apply, owner, store: createDatabaseRoleStore(client) })
  }

  async function asRole(role: string, sql: string) {
    if (!client) throw new Error('Test database is not connected')
    await client.query(`SET ROLE ${quote(role)}`)
    try {
      return await client.query(sql)
    } finally {
      await client.query('RESET ROLE')
    }
  }

  async function createRuntimeRoles() {
    await client!.query(`CREATE ROLE repkey_app LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE repkey_system LOGIN NOINHERIT BYPASSRLS`)
  }

  async function catalogState() {
    return (
      await observer!.query(`SELECT
      (SELECT jsonb_agg(r ORDER BY r.rolname) FROM pg_roles r
        WHERE r.rolname IN ('repkey_app', 'repkey_system')) AS roles,
      (SELECT datacl FROM pg_database WHERE datname = current_database()) AS database_acl,
      (SELECT jsonb_agg(n ORDER BY n.oid) FROM pg_namespace n
        WHERE n.nspname = 'public') AS schemas,
      (SELECT jsonb_agg(c ORDER BY c.oid) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public') AS relations,
      (SELECT jsonb_agg(d ORDER BY d.oid) FROM pg_default_acl d) AS defaults`)
    ).rows
  }

  async function expectPrivileges(table: string, sequence: string) {
    for (const role of runtimeRoles) {
      const result = await observer!.query(
        `SELECT
        has_database_privilege($1, current_database(), 'CONNECT') AS connect,
        has_database_privilege($1, current_database(), 'CREATE') AS create_database,
        has_schema_privilege($1, 'public', 'USAGE') AS usage,
        has_schema_privilege($1, 'public', 'CREATE') AS create_schema,
        has_table_privilege($1, $2, 'SELECT') AS read,
        has_table_privilege($1, $2, 'INSERT') AS insert,
        has_table_privilege($1, $2, 'UPDATE') AS update,
        has_table_privilege($1, $2, 'DELETE') AS delete,
        has_table_privilege($1, $2, 'TRUNCATE') AS truncate,
        has_table_privilege($1, $2, 'TRIGGER') AS trigger,
        has_table_privilege($1, $2, 'REFERENCES') AS references,
        has_table_privilege($1, $2, 'SELECT WITH GRANT OPTION') AS grant_option,
        has_sequence_privilege($1, $3, 'USAGE') AS sequence_usage,
        has_sequence_privilege($1, $3, 'SELECT') AS sequence_read,
        has_sequence_privilege($1, $3, 'UPDATE') AS sequence_update`,
        [role, table, sequence],
      )
      expect(result.rows).toEqual([
        {
          connect: true,
          create_database: false,
          usage: true,
          create_schema: false,
          read: true,
          insert: true,
          update: true,
          delete: true,
          truncate: false,
          trigger: false,
          references: false,
          grant_option: false,
          sequence_usage: true,
          sequence_read: true,
          sequence_update: false,
        },
      ])
    }
  }

  it('reports missing roles and grants without changing the catalog', async () => {
    let before = await catalogState()
    await expect(command(false)).resolves.toEqual({
      state: 'missing',
      missing: [...runtimeRoles],
    })
    expect(await catalogState()).toEqual(before)
    await createRuntimeRoles()
    before = await catalogState()
    await expect(command(false)).resolves.toEqual({ state: 'missing', missing: [] })
    expect(await catalogState()).toEqual(before)
  })

  it('provisions restricted roles, current and future grants, and reruns idempotently', async () => {
    await expect(command(true)).resolves.toEqual({ state: 'applied', missing: [] })
    const roles = await observer!.query(`SELECT rolname, rolcanlogin, rolinherit,
      rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname IN ('repkey_app', 'repkey_system') ORDER BY rolname`)
    expect(roles.rows).toEqual(
      runtimeRoles.map((rolname) => ({
        rolname,
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: rolname === 'repkey_system',
      })),
    )
    await expectPrivileges('records', 'records_id_seq')
    const before = await catalogState()
    await expect(command(false)).resolves.toEqual({ state: 'ready', missing: [] })
    await expect(command(true)).resolves.toEqual({ state: 'applied', missing: [] })
    expect(await catalogState()).toEqual(before)
    await asRole(owner, 'CREATE TABLE future_records (id serial, value integer)')
    await expectPrivileges('future_records', 'future_records_id_seq')
    await asRole(
      'repkey_app',
      `INSERT INTO future_records (value) VALUES (1);
      UPDATE future_records SET value = 2; DELETE FROM future_records`,
    )
    await asRole(owner, 'ALTER TABLE records ENABLE ROW LEVEL SECURITY')
    expect((await asRole('repkey_app', 'SELECT * FROM records')).rows).toEqual([])
    await expect(
      asRole('repkey_app', 'INSERT INTO records (value) VALUES (8)'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(asRole('repkey_app', 'TRUNCATE records')).rejects.toMatchObject({
      code: '42501',
    })
    expect((await asRole('repkey_system', 'SELECT value FROM records')).rows).toEqual([
      { value: 7 },
    ])
  })

  it.each([
    {
      sql: 'ALTER ROLE repkey_app BYPASSRLS',
      error: 'repkey_app has an unexpected row-security bypass setting',
    },
    {
      sql: 'GRANT TRUNCATE ON records TO repkey_app',
      error: 'repkey_app has ownership or elevated privileges',
    },
    {
      sql: 'GRANT REFERENCES ON records TO PUBLIC',
      error: 'repkey_app has ownership or elevated privileges',
    },
    {
      sql: 'GRANT SELECT ON records TO repkey_app WITH GRANT OPTION',
      error: 'repkey_app has ownership or elevated privileges',
    },
    {
      sql: 'GRANT CREATE ON SCHEMA public TO PUBLIC',
      error: 'PUBLIC permits object creation; review those grants first',
    },
    {
      sql: 'GRANT repkey_system TO repkey_app',
      error: 'repkey_app has ownership or elevated privileges',
    },
  ])(
    'refuses unsafe existing privileges without repairing them: $sql',
    async ({ sql, error }) => {
      await createRuntimeRoles()
      await client!.query(sql)
      const before = await catalogState()
      await expect(command(false)).rejects.toThrow(error)
      await expect(command(true)).rejects.toThrow(error)
      expect(await catalogState()).toEqual(before)
    },
  )

  const unsafeDefaults = ['TRUNCATE', 'TRIGGER', 'REFERENCES'].flatMap((privilege) =>
    [...runtimeRoles, 'PUBLIC'].flatMap((grantee) =>
      [false, true].map((global) => ({ privilege, grantee, global })),
    ),
  )
  it.each(unsafeDefaults)(
    'rejects $privilege defaults to $grantee with global=$global before any grants',
    async ({ privilege, grantee, global }) => {
      await createRuntimeRoles()
      await client!.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)}
        ${global ? '' : 'IN SCHEMA public'} GRANT ${privilege} ON TABLES TO ${grantee}`)
      const before = await catalogState()
      await expect(command(false)).rejects.toThrow('Unsafe default privileges')
      await expect(command(true)).rejects.toThrow('Unsafe default privileges')
      expect(await catalogState()).toEqual(before)
    },
  )

  it('rejects global PUBLIC defaults from another creator even when runtime roles are absent', async () => {
    otherCreator = `role_creator_${randomUUID().replaceAll('-', '')}`
    await client!.query(`CREATE ROLE ${quote(otherCreator)} NOLOGIN;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(otherCreator)} GRANT TRUNCATE ON TABLES TO PUBLIC`)
    const before = await catalogState()
    await expect(command(false)).rejects.toThrow('Unsafe default privileges')
    await expect(command(true)).rejects.toThrow('Unsafe default privileges')
    expect(await catalogState()).toEqual(before)
  })

  it('accepts ordinary global default DML without treating owner privileges as runtime grants', async () => {
    await createRuntimeRoles()
    await client!.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)}
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO repkey_app`)
    await expect(command(true)).resolves.toEqual({ state: 'applied', missing: [] })
    await asRole(owner, 'CREATE TABLE future_records (id serial, value integer)')
    await expectPrivileges('future_records', 'future_records_id_seq')
  })

  it.each([
    'GRANT SELECT ON TABLES TO repkey_app WITH GRANT OPTION',
    'GRANT USAGE ON SEQUENCES TO repkey_system WITH GRANT OPTION',
    'GRANT CREATE ON SCHEMAS TO PUBLIC',
  ])('rejects other unsafe global defaults: %s', async (grant) => {
    await createRuntimeRoles()
    await client!.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)} ${grant}`)
    const before = await catalogState()
    await expect(command(false)).rejects.toThrow('Unsafe default privileges')
    await expect(command(true)).rejects.toThrow('Unsafe default privileges')
    expect(await catalogState()).toEqual(before)
  })

  it('rechecks default grants inside the provisioning transaction', async () => {
    const store = createDatabaseRoleStore(client!)
    expect((await store.inspect(owner)).unsafeDefaultPrivileges).toBe(false)
    await observer!.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)}
      GRANT TRUNCATE ON TABLES TO PUBLIC`)
    const before = await catalogState()
    await expect(store.provision(owner, runtimeRoles)).rejects.toThrow(
      'Unsafe default privileges',
    )
    expect(await catalogState()).toEqual(before)
    expect((await client!.query('SELECT 1 AS alive')).rows).toEqual([{ alive: 1 }])
  })

  it.each([
    { action: "RAISE EXCEPTION 'default grant refused'", error: 'default grant refused' },
    {
      action: 'ALTER ROLE repkey_app BYPASSRLS',
      error: 'unexpected row-security bypass',
    },
  ])(
    'rolls back role creation and all grants after $error',
    async ({ action, error }) => {
      await client!.query(`CREATE FUNCTION reject_defaults() RETURNS event_trigger
      LANGUAGE plpgsql AS $$ BEGIN ${action}; END $$;
      CREATE EVENT TRIGGER reject_defaults ON ddl_command_end
      WHEN TAG IN ('ALTER DEFAULT PRIVILEGES') EXECUTE FUNCTION reject_defaults()`)
      const before = await catalogState()
      await expect(command(true)).rejects.toThrow(error)
      expect(await catalogState()).toEqual(before)
      await client!.query('DROP EVENT TRIGGER reject_defaults')
      await expect(command(true)).resolves.toEqual({ state: 'applied', missing: [] })
    },
  )
})
