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
  /** `null` seeds a connection whose subject was redacted. */
  googleSubject?: string | null
  connectedBy?: string
  status?: string
  credentialUseState?: string
  accessToken?: string
  refreshToken?: string
  scopes?: readonly string[]
  tokenExpiresAt?: Date
  credentialAuthorizedBy?: string
  credentialAuthorizedAt?: Date
  lifecycleVersion?: number
  accessVersion?: number
  credentialGeneration?: number
  encryptionKeyId?: string
  lastSuccessfulSyncAt?: Date
  statusReason?: string
  statusChangedAt?: Date
  createdAt?: Date
  updatedAt?: Date
  /** What to do when a row with this id exists: keep it, or only refresh its status. */
  onExistingId?: 'keep' | 'refresh-status'
  /** Re-seeding the same Google subject refreshes the tokens instead of failing. */
  adoptExistingSubject?: boolean
}>

const SEEDED_CONNECTED_BY = 'seed-user'

/** Optional seed fields that map one to one onto a column. */
const OPTIONAL_COLUMNS = [
  ['credentialAuthorizedBy', 'credential_authorized_by'],
  ['credentialAuthorizedAt', 'credential_authorized_at'],
  ['lifecycleVersion', 'lifecycle_version'],
  ['accessVersion', 'access_version'],
  ['credentialGeneration', 'credential_generation'],
  ['encryptionKeyId', 'encryption_key_id'],
  ['lastSuccessfulSyncAt', 'last_successful_sync_at'],
  ['statusReason', 'status_reason'],
  ['statusChangedAt', 'status_changed_at'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
] as const satisfies ReadonlyArray<readonly [keyof GoogleConnectionSeed, string]>

const ADOPT_EXISTING_SUBJECT = ` ON CONFLICT (google_subject) WHERE google_subject IS NOT NULL
        DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          status = 'active'`

function conflictClause(seed: GoogleConnectionSeed): string {
  if (seed.adoptExistingSubject) return ADOPT_EXISTING_SUBJECT
  if (seed.onExistingId === 'keep') return ' ON CONFLICT (id) DO NOTHING'
  if (seed.onExistingId === 'refresh-status') {
    return ' ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status'
  }
  return ''
}

/** A column and the value bound to it. */
type Binding = readonly [column: string, value: unknown]

function requiredBindings(seed: GoogleConnectionSeed): Binding[] {
  return [
    ['organization_id', seed.organizationId],
    [
      'google_subject',
      seed.googleSubject === undefined
        ? `subject-${seed.id ?? seed.organizationId}`
        : seed.googleSubject,
    ],
    ['encrypted_access_token', seed.accessToken ?? 'enc-a'],
    ['encrypted_refresh_token', seed.refreshToken ?? 'enc-r'],
    ['scopes', seed.scopes ?? BUSINESS_MANAGE_SCOPES],
    ['connected_by', seed.connectedBy ?? SEEDED_CONNECTED_BY],
    ['status', seed.status ?? 'active'],
    ['credential_use_state', seed.credentialUseState ?? 'active'],
  ]
}

function optionalBindings(seed: GoogleConnectionSeed): Binding[] {
  const bindings: Binding[] = []
  if (seed.id !== undefined) bindings.push(['id', seed.id])
  if (seed.tokenExpiresAt !== undefined) {
    bindings.push(['token_expires_at', seed.tokenExpiresAt])
  }
  for (const [field, column] of OPTIONAL_COLUMNS) {
    const value = seed[field]
    if (value !== undefined) bindings.push([column, value])
  }
  return bindings
}

export async function seedGoogleConnection(
  db: SeedQueryRunner,
  seed: GoogleConnectionSeed,
): Promise<{ connectionId: string }> {
  const bindings = [...requiredBindings(seed), ...optionalBindings(seed)]
  const columns = bindings.map(([column]) => column)
  const placeholders = bindings.map((_, index) => `$${index + 1}`)
  const values = bindings.map(([, value]) => value)
  columns.push('visibility')
  placeholders.push(`'organization'`)
  if (seed.tokenExpiresAt === undefined) {
    columns.push('token_expires_at')
    placeholders.push(`NOW() + INTERVAL '1 hour'`)
  }
  const result = await db.query(
    `INSERT INTO google_connections (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})${conflictClause(seed)}
     RETURNING id`,
    values,
  )
  const row = result.rows[0] as { id: string } | undefined
  if (!row && seed.onExistingId === 'keep' && seed.id !== undefined) {
    return { connectionId: seed.id }
  }
  if (!row) throw new Error('Google connection seed returned no row')
  return { connectionId: row.id }
}
