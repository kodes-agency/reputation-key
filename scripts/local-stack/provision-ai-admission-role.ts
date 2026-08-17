import { Client } from 'pg'

const ROLE = 'repkey_ai_admission_local'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required local AI admission setting is missing: ${name}`)
  return value
}

async function main(): Promise<void> {
  const password = requiredEnv('AI_CONTROL_DATABASE_PASSWORD')
  if (!/^[a-f0-9]{64}$/.test(password)) {
    throw new Error('local AI admission database password is invalid')
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
      throw new Error('could not quote local AI admission database settings')
    }
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE};
        END IF;
      END
      $$;
      ALTER ROLE ${ROLE}
        WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
        CONNECTION LIMIT 8 PASSWORD ${passwordLiteral};
      ALTER ROLE ${ROLE} SET lock_timeout = '1s';
      ALTER ROLE ${ROLE} SET statement_timeout = '3s';
      ALTER ROLE ${ROLE} SET idle_in_transaction_session_timeout = '5s';
      GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${ROLE};
      REVOKE ALL ON SCHEMA public FROM ${ROLE};
      GRANT USAGE ON SCHEMA public TO ${ROLE};
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE};
      REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION admit_ai_property_v1(jsonb, varchar, varchar, varchar) TO ${ROLE};
      GRANT EXECUTE ON FUNCTION admit_ai_canary_v1(jsonb, varchar, varchar, varchar) TO ${ROLE};
      GRANT EXECUTE ON FUNCTION settle_ai_execution_v1(jsonb, varchar) TO ${ROLE};
      GRANT EXECUTE ON FUNCTION reap_expired_ai_execution_permits_v1(integer) TO ${ROLE};
      GRANT EXECUTE ON FUNCTION assert_ai_runtime_catalogue_ready_v1(text, text, text) TO ${ROLE};
    `)
  } finally {
    await client.end()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[ai-admission-role] failed: ${message}\n`)
  process.exit(1)
})
