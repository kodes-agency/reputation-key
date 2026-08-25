import { Client } from 'pg'

const DEFAULT_ROLE = 'repkey_google_admission'
const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`required Google admission role setting is missing: ${name}`)
  return value
}

function assertApply(): void {
  if (!process.argv.includes('--apply')) {
    throw new Error('refusing to provision a database role without --apply')
  }
}

async function main(): Promise<void> {
  assertApply()
  const role = process.env.GOOGLE_ADMISSION_DATABASE_ROLE ?? DEFAULT_ROLE
  const password = requiredEnv('GOOGLE_ADMISSION_DATABASE_PASSWORD')
  if (!ROLE_NAME.test(role) || !/^[a-f0-9]{64}$/.test(password)) {
    throw new Error('Google admission database role or password is invalid')
  }
  const client = new Client({ connectionString: requiredEnv('DATABASE_URL') })
  await client.connect()
  try {
    const quoted = await client.query<{ password: string; database: string }>(
      'SELECT quote_literal($1)::text AS password, quote_ident(current_database())::text AS database',
      [password],
    )
    const passwordLiteral = quoted.rows[0]?.password
    const databaseIdentifier = quoted.rows[0]?.database
    if (!passwordLiteral || !databaseIdentifier) {
      throw new Error('could not quote Google admission database settings')
    }
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role};
        END IF;
      END
      $$;
      ALTER ROLE ${role}
        WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
        CONNECTION LIMIT 6 PASSWORD ${passwordLiteral};
      ALTER ROLE ${role} SET lock_timeout = '1s';
      ALTER ROLE ${role} SET statement_timeout = '3s';
      ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '5s';
      GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${role};
      REVOKE ALL ON SCHEMA public FROM ${role};
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ${role};
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role};
      REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.load_google_execution_permit_v1(uuid) TO ${role};
      GRANT EXECUTE ON FUNCTION public.start_google_execution_permit_v1(
        uuid, bigint, bigint, bigint, text, text, text, jsonb, text
      ) TO ${role};
      GRANT EXECUTE ON FUNCTION public.fail_google_execution_permit_v1(
        uuid, bigint, bigint, bigint, text, text, text, text
      ) TO ${role};
      GRANT EXECUTE ON FUNCTION public.complete_google_execution_permit_v1(
        uuid, text, text, integer
      ) TO ${role};
    `)
    process.stdout.write(
      `[google-admission-role] ${role} is execute-only on ${databaseIdentifier}\n`,
    )
  } finally {
    await client.end()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[google-admission-role] failed: ${message}\n`)
  process.exit(1)
})
