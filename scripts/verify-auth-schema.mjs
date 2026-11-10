// Verify the Better Auth table column casing matches what the DAC triggers,
// functions, and app-owned role/invitation services depend on.
//
// The DAC raw-SQL migration references BA-owned tables by EXACT column name
// (member("organizationId","role","userId"), organizationRole("organizationId",
// "role","permission"), invitation("role" NULLABLE, "propertyIds")). A better-auth
// upgrade that renames or drops these columns silently breaks the triggers.
//
// Run: pnpm audit:auth-schema   (or in CI after deploy/migrate)
// Exits non-zero on any mismatch.
import pg from 'pg'

const EXPECTED = {
  member: ['id', 'organizationId', 'userId', 'role', 'createdAt'],
  invitation: [
    'id',
    'organizationId',
    'email',
    'role',
    'status',
    'expiresAt',
    'createdAt',
    'inviterId',
    'propertyIds',
  ],
}

const RETIRED_TABLES = ['organizationRole']

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
let failures = []

try {
  await client.connect()
  for (const [table, expectedCols] of Object.entries(EXPECTED)) {
    const res = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    )
    if (res.rows.length === 0) {
      failures.push(`${table}: table not found (run pnpm db:migrate-deploy)`)
      continue
    }
    const actual = new Set(res.rows.map((r) => r.column_name))
    for (const col of expectedCols) {
      if (!actual.has(col)) {
        failures.push(`${table}: missing column "${col}"`)
      }
    }
  }
  for (const table of RETIRED_TABLES) {
    const res = await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
      `public."${table}"`,
    ])
    if (res.rows[0]?.present) {
      failures.push(`${table}: dropped table exists again (Better Auth recreated it)`)
    }
  }
} finally {
  await client.end()
}

if (failures.length > 0) {
  console.error(
    '✗ Auth schema casing mismatch — a better-auth upgrade may have renamed columns:',
  )
  for (const f of failures) console.error('  ' + f)
  console.error(
    'The DAC triggers + app-owned invitation services depend on these exact column names.',
  )
  process.exit(1)
}

console.log('✓ Auth schema casing verified (member, invitation; no organizationRole).')
