// One way to put a Google connection row on a real PostgreSQL database.
//
// The browser journeys' seeds (e2e/helpers) and the integration suites both
// need an ACTIVE connection without a Google consent screen. They run this one
// statement through whichever executor they hold: a pg Pool, a held
// transaction's client, or the e2e pool's query function.

const BUSINESS_MANAGE_SCOPES = ['https://www.googleapis.com/auth/business.manage']

export type SeedQueryRunner = Readonly<{
  query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>
}>

export type GoogleConnectionSeed = Readonly<{
  id?: string
  organizationId: string
  googleSubject?: string
  connectedBy?: string
  status?: string
  credentialUseState?: string
  accessToken?: string
  refreshToken?: string
  /** Re-seeding the same Google subject refreshes the tokens instead of failing. */
  adoptExistingSubject?: boolean
}>

export const SEEDED_CONNECTED_BY = 'seed-user'

export async function seedGoogleConnection(
  db: SeedQueryRunner,
  seed: GoogleConnectionSeed,
): Promise<{ connectionId: string }> {
  const columns = [
    'organization_id',
    'google_subject',
    'encrypted_access_token',
    'encrypted_refresh_token',
    'token_expires_at',
    'scopes',
    'connected_by',
    'visibility',
    'status',
    'credential_use_state',
  ]
  const values: unknown[] = [
    seed.organizationId,
    seed.googleSubject ?? `subject-${seed.id ?? seed.organizationId}`,
    seed.accessToken ?? 'enc-a',
    seed.refreshToken ?? 'enc-r',
  ]
  const placeholders = ['$1', '$2', '$3', '$4', `NOW() + INTERVAL '1 hour'`]
  const bind = (value: unknown): string => {
    values.push(value)
    return `$${values.length}`
  }
  placeholders.push(
    bind(BUSINESS_MANAGE_SCOPES),
    bind(seed.connectedBy ?? SEEDED_CONNECTED_BY),
    `'organization'`,
    bind(seed.status ?? 'active'),
    bind(seed.credentialUseState ?? 'active'),
  )
  if (seed.id !== undefined) {
    columns.unshift('id')
    placeholders.unshift(bind(seed.id))
  }
  const adopt = seed.adoptExistingSubject
    ? ` ON CONFLICT (google_subject) WHERE google_subject IS NOT NULL
        DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          status = 'active'`
    : ''
  const result = await db.query(
    `INSERT INTO google_connections (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})${adopt}
     RETURNING id`,
    values,
  )
  const row = result.rows[0] as { id: string } | undefined
  if (!row) throw new Error('Google connection seed returned no row')
  return { connectionId: row.id }
}
