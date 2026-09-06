import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  localStackEnvironment,
  type LocalStackMode,
} from '#/shared/config/local-stack-contract'

export type { LocalStackMode }

const MODES: ReadonlySet<string> = new Set(['beta', 'e2e', 'perf'])

export function parseLocalStackMode(value: string | undefined): LocalStackMode {
  const mode = value ?? 'e2e'
  if (!MODES.has(mode)) {
    throw new Error(`Invalid local stack mode "${mode}"; expected beta, e2e, or perf`)
  }
  return mode as LocalStackMode
}

export function localStackProject(mode: LocalStackMode): string {
  return `repkey-${mode}`
}

// queueRedis is mapped for the same reason postgres is: e2e fixtures enqueue
// the jobs the app would enqueue, and BullMQ state lives in a SEPARATE Redis
// from the cache. Without a host port the fixtures could only reach the cache
// Redis, so `sync-property-reviews` and friends landed in a queue no worker
// consumes and the tests waited out their budget on work that never ran.
const HOST_PORTS = {
  e2e: { postgres: 55432, redis: 56379, queueRedis: 56389 },
  perf: { postgres: 55433, redis: 56380, queueRedis: 56390 },
  beta: { postgres: 55434, redis: 56381, queueRedis: 56391 },
} as const satisfies Record<LocalStackMode, LocalStackHostPorts>

export type LocalStackHostPorts = Readonly<{
  postgres: number
  redis: number
  queueRedis: number
}>

export function localStackHostPorts(mode: LocalStackMode): LocalStackHostPorts {
  return HOST_PORTS[mode]
}

function secret(revision: string, label: string): string {
  return createHash('sha256').update(`rep-key/local/${revision}/${label}`).digest('hex')
}

export type LocalStackRunKind = 'clean' | 'upgrade'

export type MigrationHeadProof = Readonly<{
  runKind: LocalStackRunKind
  expectedTag: string
  expectedCount: number
  expectedWhen: number
  expectedSqlSha256: string
  appliedCount: number
  appliedHash: string
  appliedWhen: number
  matched: boolean
}>

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function expectedMigrationHead(
  journalPath: string,
  migrationDirectory: string,
): Readonly<{ tag: string; when: number; sqlSha256: string; count: number }> {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: ReadonlyArray<{ tag?: string; when?: number }>
  }
  const entry = journal.entries?.at(-1)
  if (!entry?.tag || !Number.isSafeInteger(entry.when)) {
    throw new Error(`Migration journal ${basename(journalPath)} has no valid head`)
  }
  const sql = readFileSync(`${migrationDirectory}/${entry.tag}.sql`)
  return {
    tag: entry.tag,
    when: entry.when as number,
    sqlSha256: sha256(sql),
    count: journal.entries?.length ?? 0,
  }
}

export function createMigrationHeadProof(
  input: Readonly<{
    runKind: LocalStackRunKind
    expected: Readonly<{ tag: string; when: number; sqlSha256: string; count: number }>
    appliedCount: number
    appliedHash: string
    appliedWhen: number
  }>,
): MigrationHeadProof {
  return {
    runKind: input.runKind,
    expectedTag: input.expected.tag,
    expectedCount: input.expected.count,
    expectedWhen: input.expected.when,
    expectedSqlSha256: input.expected.sqlSha256,
    appliedCount: input.appliedCount,
    appliedHash: input.appliedHash,
    appliedWhen: input.appliedWhen,
    matched:
      input.appliedCount === input.expected.count &&
      input.appliedHash === input.expected.sqlSha256 &&
      input.appliedWhen === input.expected.when,
  }
}

export function deterministicFixtureHash(
  input: Readonly<{
    seed: string
    properties: number
    p1Properties: number
    capabilities: readonly string[]
  }>,
): string {
  return sha256(
    JSON.stringify({
      version: 'fleet-local-2',
      seed: input.seed,
      properties: input.properties,
      p1Properties: input.p1Properties,
      capabilities: [...input.capabilities].sort(),
    }),
  )
}

export function buildLocalStackEnv(
  input: Readonly<{
    mode: LocalStackMode
    revision: string
    artifactDir: string
    e2eDir: string
  }>,
): Readonly<Record<string, string>> {
  if (!/^[a-f0-9]{40,64}$/i.test(input.revision)) {
    throw new Error('Local stack SOURCE_REVISION must be a concrete git revision')
  }

  const auth = secret(input.revision, 'better-auth')
  const database = secret(input.revision, 'postgres')
  const minio = secret(input.revision, 'minio')
  const testUser = secret(input.revision, 'test-user')
  const override = localStackEnvironment(input.mode)
  const reviewProviderSubjectKeys = `local:${secret(
    input.revision,
    'review-provider-subject',
  )}`
  const hostPorts = localStackHostPorts(input.mode)

  return {
    COMPOSE_PROJECT_NAME: localStackProject(input.mode),
    LOCAL_STACK_MODE: input.mode,
    SOURCE_REVISION: input.revision,
    STACK_ARTIFACT_DIR: input.artifactDir,
    STACK_E2E_DIR: input.e2eDir,
    POSTGRES_DB: 'repkey_local',
    POSTGRES_USER: 'repkey_local',
    POSTGRES_PASSWORD: database,
    POSTGRES_HOST_PORT: String(hostPorts.postgres),
    REDIS_HOST_PORT: String(hostPorts.redis),
    QUEUE_REDIS_HOST_PORT: String(hostPorts.queueRedis),
    BETTER_AUTH_SECRET: auth,
    RESEND_API_KEY: `re_${secret(input.revision, 'resend')}`,
    GOOGLE_CLIENT_ID: `local-${secret(input.revision, 'google-id').slice(0, 32)}`,
    GOOGLE_CLIENT_SECRET: secret(input.revision, 'google-secret'),
    ENCRYPTION_KEY: secret(input.revision, 'token-encryption'),
    OAUTH_STATE_SECRET: secret(input.revision, 'oauth-state'),
    PROVIDER_EPHEMERAL_REDIS_PASSWORD: secret(input.revision, 'provider-redis'),
    GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS: `local:${secret(input.revision, 'google-opaque-reference')}`,
    GOOGLE_REPLAY_HMAC_KEYS: `local:${secret(input.revision, 'google-replay')}`,
    GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS: `local:${secret(input.revision, 'google-oauth-state-handle')}`,
    GOOGLE_SESSION_BINDING_HMAC_KEYS: `local:${secret(input.revision, 'google-session-binding')}`,
    GOOGLE_ADMISSION_GRANT_HMAC_KEYS: `local:${secret(input.revision, 'google-admission-grant')}`,
    GOOGLE_ADMISSION_DATABASE_PASSWORD: secret(
      input.revision,
      'google-admission-database',
    ),
    GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: `local:${secret(input.revision, 'google-credential-binding')}`,
    AI_CONTROL_DATABASE_PASSWORD: secret(input.revision, 'ai-control-database'),
    AI_SUBJECT_HMAC_KEYS: `subject-v1:${secret(input.revision, 'ai-subject')}`,
    AI_REQUEST_BINDING_HMAC_KEYS: `local:${secret(input.revision, 'ai-request-binding')}`,
    AI_ADMISSION_ED25519_KID: 'admission-v1',
    REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: reviewProviderSubjectKeys,
    REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: reviewProviderSubjectKeys,
    // The worker enables notification.send_email, and bootstrap refuses that
    // capability without this key. The env schema only DEFAULTS it outside
    // production, and the local stack runs NODE_ENV=production on purpose —
    // so nothing supplied it and the worker exited at boot.
    NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS: `local:${secret(input.revision, 'notification-unsubscribe')}`,
    GUEST_CONTACT_ENCRYPTION_KEY: secret(input.revision, 'guest-contact'),
    GUEST_SESSION_SALT: secret(input.revision, 'guest-session'),
    GUEST_ABUSE_HASH_SECRET: secret(input.revision, 'guest-abuse'),
    PORTAL_TOKEN_HASH_SECRET: secret(input.revision, 'portal-token'),
    OPS_METRICS_TOKEN: secret(input.revision, 'ops-metrics'),
    MINIO_ROOT_USER: `repkey${minio.slice(0, 10)}`,
    MINIO_ROOT_PASSWORD: minio,
    S3_BUCKET_NAME: 'repkey-local-media',
    E2E_TEST_EMAIL: 'test@example.com',
    E2E_TEST_PASSWORD: `LocalE2E-${testUser.slice(0, 24)}`,
    ...override,
  }
}
