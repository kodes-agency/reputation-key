import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from 'pg'

const RUNTIME_ROLES = ['repkey_app', 'repkey_system'] as const
const USAGE = 'pnpm ops db-roles --owner <migration-role> [--apply]'

class DatabaseRoleError extends Error {}

export type RoleSafetySnapshot = Readonly<{
  ownerExists: boolean
  ownerCanMigrate: boolean
  ownerIsRuntimeRole: boolean
  publicSchemaWritable: boolean
  publicDatabaseCreate: boolean
  unsafeDefaultPrivileges: boolean
  grantsReady: boolean
  roles: ReadonlyArray<{
    name: (typeof RUNTIME_ROLES)[number]
    superuser: boolean
    bypassRls: boolean
    createRole: boolean
    createDb: boolean
    replication: boolean
    ownsObjects: boolean
    hasMemberships: boolean
    createObjects: boolean
    unsafeTablePrivileges: boolean
    grantOptions: boolean
  }>
}>

export type DatabaseRoleStore = Readonly<{
  inspect: (owner: string) => Promise<RoleSafetySnapshot>
  provision: (owner: string, missing: readonly string[]) => Promise<void>
}>

function validateOwner(owner: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(owner)) {
    throw new DatabaseRoleError(
      'Migration owner must be a lowercase PostgreSQL role name',
    )
  }
  if (RUNTIME_ROLES.some((role) => role === owner)) {
    throw new DatabaseRoleError('Migration owner must differ from the runtime roles')
  }
}

export function parseDatabaseRoleArgs(argv: readonly string[]): {
  help: boolean
  apply: boolean
  owner: string | undefined
} {
  let owner: string | undefined
  let apply = false
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' && !help) help = true
    else if (arg === '--apply' && !apply) apply = true
    else if (arg === '--owner' && owner === undefined) {
      owner = argv[++i]
      if (!owner) throw new DatabaseRoleError('Missing migration owner')
      validateOwner(owner)
    } else throw new DatabaseRoleError('Unknown or repeated argument')
  }
  if (!help && !owner) throw new DatabaseRoleError('A migration owner is required')
  return { help, apply, owner }
}

export function inspectRoleSafety(snapshot: RoleSafetySnapshot): string[] {
  const problems: string[] = []
  if (!snapshot.ownerExists) problems.push('Migration owner does not exist')
  if (!snapshot.ownerCanMigrate) problems.push('Migration owner is not authorized')
  if (snapshot.ownerIsRuntimeRole) problems.push('Runtime role cannot own migrations')
  if (snapshot.publicSchemaWritable || snapshot.publicDatabaseCreate) {
    problems.push('PUBLIC permits object creation; review those grants first')
  }
  if (snapshot.unsafeDefaultPrivileges) {
    problems.push('Unsafe default privileges; review those grants first')
  }
  for (const role of snapshot.roles) {
    if (
      role.superuser ||
      role.createRole ||
      role.createDb ||
      role.replication ||
      role.ownsObjects ||
      role.hasMemberships ||
      role.createObjects ||
      role.unsafeTablePrivileges ||
      role.grantOptions
    ) {
      problems.push(`${role.name} has ownership or elevated privileges`)
    }
    if (role.bypassRls !== (role.name === 'repkey_system')) {
      problems.push(`${role.name} has an unexpected row-security bypass setting`)
    }
  }
  return problems
}

function assertSafe(snapshot: RoleSafetySnapshot): void {
  const problems = inspectRoleSafety(snapshot)
  if (problems.length) throw new DatabaseRoleError(problems.join('; '))
}

export async function runDatabaseRoles(input: {
  apply: boolean
  owner: string
  store: DatabaseRoleStore
}): Promise<{ state: 'missing' | 'ready' | 'applied'; missing: string[] }> {
  validateOwner(input.owner)
  const before = await input.store.inspect(input.owner)
  assertSafe(before)
  const missing = RUNTIME_ROLES.filter(
    (name) => !before.roles.some((role) => role.name === name),
  )
  if (!input.apply) {
    return {
      state: missing.length || !before.grantsReady ? 'missing' : 'ready',
      missing,
    }
  }
  await input.store.provision(input.owner, missing)
  const after = await input.store.inspect(input.owner)
  assertSafe(after)
  if (
    !after.grantsReady ||
    RUNTIME_ROLES.some((name) => !after.roles.some((role) => role.name === name))
  ) {
    throw new DatabaseRoleError('Database role grants failed verification')
  }
  return { state: 'applied', missing: [] }
}

async function inspect(
  client: Pick<Client, 'query'>,
  owner: string,
): Promise<RoleSafetySnapshot> {
  const { rows: roles } = await client.query<RoleSafetySnapshot['roles'][number]>(`
    SELECT r.rolname AS name, r.rolsuper AS superuser,
      r.rolbypassrls AS "bypassRls", r.rolcreaterole AS "createRole",
      r.rolcreatedb AS "createDb", r.rolreplication AS replication,
      EXISTS (SELECT 1 FROM pg_shdepend d
        WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r.oid
          AND d.deptype = 'o') AS "ownsObjects",
      EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
        AS "hasMemberships",
      (has_database_privilege(r.oid, current_database(), 'CREATE') OR EXISTS (
        SELECT 1 FROM pg_namespace n
        WHERE n.nspname !~ '^pg_(toast_)?temp_'
          AND has_schema_privilege(r.oid, n.oid, 'CREATE'))) AS "createObjects",
      EXISTS (SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace,
        unnest(ARRAY['TRUNCATE','TRIGGER','REFERENCES']) p
        WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema')
          AND n.nspname !~ '^pg_(toast_)?temp_'
          AND c.relkind IN ('r','p','v','m','f')
          AND has_table_privilege(r.oid, c.oid, p)) AS "unsafeTablePrivileges",
      EXISTS (SELECT 1 FROM (
        SELECT a.* FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
        UNION ALL
        SELECT a.* FROM pg_database d, LATERAL aclexplode(d.datacl) a
          WHERE d.datname = current_database()
        UNION ALL
        SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
        UNION ALL
        SELECT a.* FROM pg_attribute c, LATERAL aclexplode(c.attacl) a
        UNION ALL
        SELECT a.* FROM pg_proc p, LATERAL aclexplode(p.proacl) a
        UNION ALL
        SELECT a.* FROM pg_type t, LATERAL aclexplode(t.typacl) a
        UNION ALL
        SELECT a.* FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
      ) grants WHERE grants.grantee IN (0, r.oid) AND grants.is_grantable)
        AS "grantOptions"
    FROM pg_roles r WHERE r.rolname IN ('repkey_app', 'repkey_system')
  `)
  const { rows } = await client.query<Omit<RoleSafetySnapshot, 'roles'>>(
    `
    SELECT
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "ownerExists",
      EXISTS (SELECT 1 FROM pg_roles o, pg_database d
        WHERE o.rolname = $1 AND d.datname = current_database()
          AND pg_has_role(current_user, o.oid, 'USAGE')
          AND (o.rolsuper OR d.datdba = o.oid)
          AND NOT EXISTS (SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
              AND c.relowner <> o.oid)) AS "ownerCanMigrate",
      $1 IN ('repkey_app', 'repkey_system') AS "ownerIsRuntimeRole",
      EXISTS (SELECT 1 FROM pg_namespace n,
        LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE n.nspname = 'public' AND a.grantee = 0
          AND a.privilege_type = 'CREATE') AS "publicSchemaWritable",
      EXISTS (SELECT 1 FROM pg_database d,
        LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE d.datname = current_database() AND a.grantee = 0
          AND a.privilege_type = 'CREATE') AS "publicDatabaseCreate",
      -- Global defaults add to schema defaults, and any creator can grant to PUBLIC.
      EXISTS (SELECT 1 FROM pg_default_acl d,
        LATERAL aclexplode(d.defaclacl) a
        WHERE (a.grantee = 0 OR a.grantee IN (
          SELECT oid FROM pg_roles WHERE rolname IN ('repkey_app', 'repkey_system')))
          AND (a.is_grantable
            OR (d.defaclobjtype = 'r' AND a.privilege_type NOT IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE'))
            OR (d.defaclobjtype = 'n' AND a.privilege_type = 'CREATE')))
        AS "unsafeDefaultPrivileges",
      false AS "grantsReady"
  `,
    [owner],
  )
  const snapshot = rows[0]
  if (!snapshot)
    throw new DatabaseRoleError('Database role inspection returned no result')
  let grantsReady = false
  if (roles.length === RUNTIME_ROLES.length && snapshot.ownerExists) {
    const grants = await client.query<{ ready: boolean }>(
      `
      SELECT NOT EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE r.rolname IN ('repkey_app', 'repkey_system') AND (
          NOT has_schema_privilege(r.oid, 'public', 'USAGE')
          OR NOT has_database_privilege(r.oid, current_database(), 'CONNECT')
          OR EXISTS (SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace,
            unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
              AND NOT has_table_privilege(r.oid, c.oid, p))
          OR EXISTS (SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace,
            unnest(ARRAY['USAGE','SELECT']) p
            WHERE n.nspname = 'public' AND c.relkind = 'S'
              AND NOT has_sequence_privilege(r.oid, c.oid, p))
          OR EXISTS (
            SELECT 1 FROM (VALUES
              ('r','SELECT'), ('r','INSERT'), ('r','UPDATE'), ('r','DELETE'),
              ('S','USAGE'), ('S','SELECT')) required(kind, privilege)
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_default_acl d
              JOIN pg_roles o ON o.oid = d.defaclrole
              JOIN pg_namespace n ON n.oid = d.defaclnamespace,
              LATERAL aclexplode(d.defaclacl) a
              WHERE o.rolname = $1 AND n.nspname = 'public'
                AND d.defaclobjtype::text = required.kind
                AND a.grantee = r.oid AND a.privilege_type = required.privilege))
        )) AS ready
    `,
      [owner],
    )
    grantsReady = grants.rows[0]?.ready === true
  }
  return { ...snapshot, roles, grantsReady }
}

export function createDatabaseRoleStore(
  client: Pick<Client, 'query'>,
): DatabaseRoleStore {
  return {
    inspect: (owner) => inspect(client, owner),
    provision: async (owner) => {
      validateOwner(owner)
      await client.query('BEGIN')
      try {
        await client.query("SET LOCAL lock_timeout = '5s'")
        await client.query("SET LOCAL statement_timeout = '30s'")
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('repkey.database-roles'))",
        )
        // Recheck under the lock; an earlier report is never write authority.
        const current = await inspect(client, owner)
        assertSafe(current)
        for (const role of RUNTIME_ROLES) {
          if (!current.roles.some(({ name }) => name === role)) {
            const bypass = role === 'repkey_system' ? 'BYPASSRLS' : 'NOBYPASSRLS'
            await client.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER
              NOCREATEDB NOCREATEROLE NOREPLICATION ${bypass}`)
          }
        }
        const db = await client.query<{ name: string }>(
          'SELECT current_database() AS name',
        )
        const database = db.rows[0]?.name
        if (!database) throw new DatabaseRoleError('Database identity is unavailable')
        const quotedDatabase = '"' + database.replaceAll('"', '""') + '"'
        await client.query(
          `GRANT CONNECT ON DATABASE ${quotedDatabase} TO repkey_app, repkey_system`,
        )
        await client.query('GRANT USAGE ON SCHEMA public TO repkey_app, repkey_system')
        await client.query(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO repkey_app, repkey_system',
        )
        await client.query(
          'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO repkey_app, repkey_system',
        )
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO repkey_app, repkey_system`)
        await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public
          GRANT USAGE, SELECT ON SEQUENCES TO repkey_app, repkey_system`)
        const after = await inspect(client, owner)
        assertSafe(after)
        if (!after.grantsReady || after.roles.length !== RUNTIME_ROLES.length) {
          throw new DatabaseRoleError('Database role grants failed verification')
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    },
  }
}

async function main(): Promise<number> {
  const args = parseDatabaseRoleArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`usage: ${USAGE}`)
    console.log('Report only by default. Apply requires a database administrator.')
    console.log(
      'Creates roles and grants only; credentials and service connections stay operator-managed.',
    )
    return 0
  }
  const url = process.env.DATABASE_URL
  if (!url || !args.owner)
    throw new DatabaseRoleError('DATABASE_URL and --owner are required')
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  })
  try {
    await client.connect()
    const report = await runDatabaseRoles({
      apply: args.apply,
      owner: args.owner,
      store: createDatabaseRoleStore(client),
    })
    console.log(`Database roles: ${report.state}`)
    return report.state === 'missing' ? 1 : 0
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      // Only our fixed diagnostics are safe to print; pg errors may carry secrets.
      console.error(
        error instanceof DatabaseRoleError
          ? error.message
          : 'Database role command failed; check administrator access and database connectivity',
      )
      process.exitCode = 1
    },
  )
}
