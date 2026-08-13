import { createHash } from 'node:crypto'
import type { Pool, PoolClient, QueryResult } from 'pg'
import type {
  GoogleImportCompatibilityArchiveResult,
  GoogleImportCompatibilityControl,
  GoogleImportCompatibilityInspection,
  GoogleImportCompatibilityPort,
  GoogleImportLegacyBullState,
} from './google-import-compatibility-lifecycle'
import { GOOGLE_IMPORT_LEGACY_BULL_STATES } from './google-import-compatibility-lifecycle'

export const LEGACY_IMPORT_JOB_NAME = 'import-property'
export const GOOGLE_CONNECTED_EVENT_TYPE = 'integration.google_account.connected'
export const GOOGLE_CONNECTED_EVENT_V1_CONSUMER = 'activity.event-handlers'

const BULL_JOB_TYPES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
  'paused',
  'completed',
  'failed',
] as const
const PENDING_EVENT_JOB_TYPES = BULL_JOB_TYPES.filter((state) => state !== 'completed')

export type CompatibilityBullJob = Readonly<{
  name: string
  data: unknown
  remove: (options?: Readonly<{ removeChildren?: boolean }>) => Promise<void>
}>

export type CompatibilityBullQueue = Readonly<{
  getJobs: (
    types: readonly string[],
    start?: number,
    end?: number,
    asc?: boolean,
  ) => Promise<readonly CompatibilityBullJob[]>
  getJobSchedulers: (
    start?: number,
    end?: number,
    asc?: boolean,
  ) => Promise<readonly Readonly<{ key: string; name: string }>[]>
  removeJobScheduler: (key: string) => Promise<boolean>
  getRepeatableJobs: (
    start?: number,
    end?: number,
    asc?: boolean,
  ) => Promise<readonly Readonly<{ key: string; name: string }>[]>
  removeRepeatableByKey: (key: string) => Promise<boolean>
}>

export type GoogleImportCompatibilityAdapterDeps = Readonly<{
  pool: Pool
  defaultQueue: CompatibilityBullQueue
  domainEventsQueue: CompatibilityBullQueue
  environment?: string
}>

type ControlRow = Readonly<{
  state: GoogleImportCompatibilityControl['state']
  generation: string | number
  connected_event_issuance: GoogleImportCompatibilityControl['connectedEventIssuance']
  oauth_state_issuance: GoogleImportCompatibilityControl['oauthStateIssuance']
  connected_event_converged_at: Date | null
  oauth_state_converged_at: Date | null
  v1_state_drain_not_before: Date | null
  v1_events_drained_at: Date | null
  quiescing_at: Date | null
  closed_at: Date | null
  operator_id: string | null
  reason: string | null
  updated_at: Date
}>

const CONTROL_SELECT = `
  SELECT state, generation, connected_event_issuance, oauth_state_issuance,
         connected_event_converged_at, oauth_state_converged_at,
         v1_state_drain_not_before, v1_events_drained_at,
         quiescing_at, closed_at, operator_id, reason, updated_at
  FROM legacy_import_control
  WHERE environment = $1`

function mapControl(row: ControlRow | undefined): GoogleImportCompatibilityControl {
  if (!row) throw new Error('legacy import control row is missing')
  const generation = Number(row.generation)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('legacy import control generation is invalid')
  }
  return {
    state: row.state,
    generation,
    connectedEventIssuance: row.connected_event_issuance,
    oauthStateIssuance: row.oauth_state_issuance,
    connectedEventConvergedAt: row.connected_event_converged_at,
    oauthStateConvergedAt: row.oauth_state_converged_at,
    v1StateDrainNotBefore: row.v1_state_drain_not_before,
    v1EventsDrainedAt: row.v1_events_drained_at,
    quiescingAt: row.quiescing_at,
    closedAt: row.closed_at,
    operatorId: row.operator_id,
    reason: row.reason,
    updatedAt: row.updated_at,
  }
}

function emptyLegacyJobs(): Record<GoogleImportLegacyBullState, number> {
  return Object.fromEntries(
    GOOGLE_IMPORT_LEGACY_BULL_STATES.map((state) => [state, 0]),
  ) as Record<GoogleImportLegacyBullState, number>
}

function isConnectedEventV1(job: CompatibilityBullJob): boolean {
  if (job.name !== GOOGLE_CONNECTED_EVENT_TYPE) return false
  if (typeof job.data !== 'object' || job.data === null || Array.isArray(job.data)) {
    return false
  }
  return (job.data as Record<string, unknown>).eventVersion === 1
}

function bullStateName(
  type: (typeof BULL_JOB_TYPES)[number],
): GoogleImportLegacyBullState {
  return type === 'waiting-children' ? 'waitingChildren' : type
}

async function inspectQueues(
  defaultQueue: CompatibilityBullQueue,
  domainEventsQueue: CompatibilityBullQueue,
): Promise<GoogleImportCompatibilityInspection['queues']> {
  const legacyJobs = emptyLegacyJobs()
  for (const type of BULL_JOB_TYPES) {
    const jobs = await defaultQueue.getJobs([type], 0, -1, true)
    legacyJobs[bullStateName(type)] = jobs.filter(
      (job) => job.name === LEGACY_IMPORT_JOB_NAME,
    ).length
  }
  const [schedulers, repeatables, eventJobs] = await Promise.all([
    defaultQueue.getJobSchedulers(0, -1, true),
    defaultQueue.getRepeatableJobs(0, -1, true),
    domainEventsQueue.getJobs(PENDING_EVENT_JOB_TYPES, 0, -1, true),
  ])
  return {
    legacyJobs,
    legacySchedulers: schedulers.filter((entry) => entry.name === LEGACY_IMPORT_JOB_NAME)
      .length,
    legacyRepeatables: repeatables.filter(
      (entry) => entry.name === LEGACY_IMPORT_JOB_NAME,
    ).length,
    pendingConnectedV1: eventJobs.filter(isConnectedEventV1).length,
  }
}

async function readInspection(
  client: PoolClient,
  environment: string,
  queues: GoogleImportCompatibilityInspection['queues'],
): Promise<GoogleImportCompatibilityInspection> {
  const controlResult = await client.query<ControlRow>(CONTROL_SELECT, [environment])
  const statusResult = await client.query<{ status: string; count: string }>(`
    SELECT status::text AS status, count(*)::bigint AS count
    FROM gbp_import_jobs
    GROUP BY status
    ORDER BY status`)
  const outboxResult = await client.query<{ count: string }>(
    `
    SELECT count(*)::bigint AS count
    FROM outbox_events event
    WHERE event.event_type = $1
      AND event.event_version = 1
      AND (
        event.published_at IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM event_consumer_receipts receipt
          WHERE receipt.event_id = event.id
            AND receipt.consumer_name = $2
            AND receipt.status IN ('applied', 'duplicate', 'obsolete')
        )
      )`,
    [GOOGLE_CONNECTED_EVENT_TYPE, GOOGLE_CONNECTED_EVENT_V1_CONSUMER],
  )
  const leasesResult = await client.query<{ count: string }>(
    `
    SELECT count(*)::bigint AS count
    FROM legacy_import_effect_leases
    WHERE environment = $1 AND state = 'active'`,
    [environment],
  )
  const statuses: Record<string, number> = {}
  let total = 0
  let nonterminal = 0
  for (const row of statusResult.rows) {
    const count = Number(row.count)
    statuses[row.status] = count
    total += count
    if (row.status === 'queued' || row.status === 'in_progress') nonterminal += count
  }
  return {
    control: mapControl(controlResult.rows[0]),
    legacyRows: { total, nonterminal, statuses },
    outbox: { pendingConnectedV1: Number(outboxResult.rows[0]?.count ?? 0) },
    leases: { active: Number(leasesResult.rows[0]?.count ?? 0) },
    queues,
  }
}

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await work(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function updateControl(
  pool: Pool,
  environment: string,
  expectedGeneration: number,
  sql: string,
  values: readonly unknown[],
): Promise<GoogleImportCompatibilityControl> {
  return inTransaction(pool, async (client) => {
    await client.query(`${CONTROL_SELECT} FOR UPDATE`, [environment])
    const result = await client.query<ControlRow>(sql, [
      environment,
      expectedGeneration,
      ...values,
    ])
    if (result.rowCount !== 1) {
      throw new Error(
        'legacy import control changed concurrently or transition was denied',
      )
    }
    return mapControl(result.rows[0])
  })
}

function digestLegacyRow(row: LegacyImportRow): string {
  const stable = JSON.stringify({
    id: row.id,
    organizationId: row.organization_id,
    initiatedBy: row.initiated_by,
    status: row.status,
    totalCount: row.total_count,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
  return createHash('sha256').update(stable).digest('hex')
}

function aggregateDigest(digests: readonly string[]): string {
  return createHash('sha256')
    .update([...digests].sort().join(''))
    .digest('hex')
}

type LegacyImportRow = Readonly<{
  id: string
  organization_id: string
  initiated_by: string
  status: 'completed' | 'completed_with_skips' | 'completed_with_failures' | 'failed'
  total_count: number
  imported_count: number
  skipped_count: number
  failed_count: number
  created_at: Date
  updated_at: Date
}>

function normalizedStatus(
  status: LegacyImportRow['status'],
): 'completed' | 'completed_with_issues' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'completed_with_issues'
}

async function archiveTerminalRows(
  client: PoolClient,
  input: Readonly<{
    environment: string
    expectedGeneration: number
    operatorId: string
    reason: string
    now: Date
  }>,
): Promise<GoogleImportCompatibilityArchiveResult> {
  const control = await client.query<ControlRow>(`${CONTROL_SELECT} FOR UPDATE`, [
    input.environment,
  ])
  const current = mapControl(control.rows[0])
  if (current.state !== 'closed' || current.generation !== input.expectedGeneration) {
    throw new Error('legacy import control changed concurrently or is not closed')
  }
  const source = await client.query<LegacyImportRow>(`
    SELECT id, organization_id, initiated_by, status::text AS status,
           total_count, imported_count, skipped_count, failed_count,
           created_at, updated_at
    FROM gbp_import_jobs
    ORDER BY id
    FOR UPDATE`)
  const nonterminal = source.rows.find(
    (row) =>
      row.status === ('queued' as string) || row.status === ('in_progress' as string),
  )
  if (nonterminal) throw new Error('legacy import rows are not terminal')

  const rowDigests = source.rows.map((row) => ({ row, digest: digestLegacyRow(row) }))
  for (const { row, digest } of rowDigests) {
    await client.query(
      `INSERT INTO gbp_import_legacy_history (
         id, organization_id, initiated_by, contract_version, original_status,
         normalized_status, total_count, imported_count, skipped_count, failed_count,
         original_created_at, original_updated_at, archived_at, row_digest,
         abandoned_by, abandon_reason
       ) VALUES ($1,$2,$3,'legacy-v1',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.organization_id,
        row.initiated_by,
        row.status,
        normalizedStatus(row.status),
        row.total_count,
        row.imported_count,
        row.skipped_count,
        row.failed_count,
        row.created_at,
        row.updated_at,
        input.now,
        digest,
      ],
    )
  }
  const ids = source.rows.map((row) => row.id)
  const archived =
    ids.length === 0
      ? ({ rows: [], rowCount: 0 } as unknown as QueryResult<{ row_digest: string }>)
      : await client.query<{ row_digest: string }>(
          `SELECT row_digest FROM gbp_import_legacy_history
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
          [ids],
        )
  const sourceDigest = aggregateDigest(rowDigests.map((entry) => entry.digest))
  const archivedDigest = aggregateDigest(archived.rows.map((row) => row.row_digest))
  if (archived.rowCount !== source.rowCount || archivedDigest !== sourceDigest) {
    throw new Error('legacy import archive count/digest parity failed')
  }
  const deleted =
    ids.length === 0
      ? ({ rowCount: 0 } as QueryResult)
      : await client.query('DELETE FROM gbp_import_jobs WHERE id = ANY($1::uuid[])', [
          ids,
        ])
  if (deleted.rowCount !== source.rowCount) {
    throw new Error('legacy import archive delete parity failed')
  }
  return {
    sourceCount: source.rowCount ?? 0,
    archivedCount: archived.rowCount ?? 0,
    deletedCount: deleted.rowCount ?? 0,
    sourceDigest,
    archivedDigest,
  }
}

async function removeDormantLegacyEntries(queue: CompatibilityBullQueue): Promise<void> {
  const [schedulers, repeatables] = await Promise.all([
    queue.getJobSchedulers(0, -1, true),
    queue.getRepeatableJobs(0, -1, true),
  ])
  for (const scheduler of schedulers) {
    if (scheduler.name === LEGACY_IMPORT_JOB_NAME) {
      await queue.removeJobScheduler(scheduler.key)
    }
  }
  for (const repeatable of repeatables) {
    if (repeatable.name === LEGACY_IMPORT_JOB_NAME) {
      await queue.removeRepeatableByKey(repeatable.key)
    }
  }
  for (const type of BULL_JOB_TYPES) {
    if (type === 'active') continue
    const jobs = await queue.getJobs([type], 0, -1, true)
    for (const job of jobs) {
      if (job.name === LEGACY_IMPORT_JOB_NAME) {
        await job.remove({ removeChildren: true })
      }
    }
  }
}

export function createGoogleImportCompatibilityAdapter(
  deps: GoogleImportCompatibilityAdapterDeps,
): GoogleImportCompatibilityPort {
  const environment = deps.environment ?? 'global'
  return {
    inspect: async () => {
      const queues = await inspectQueues(deps.defaultQueue, deps.domainEventsQueue)
      return inTransaction(deps.pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return readInspection(client, environment, queues)
      })
    },

    advanceConnectedEventIssuance: (input) =>
      updateControl(
        deps.pool,
        environment,
        input.expectedGeneration,
        `UPDATE legacy_import_control
         SET connected_event_issuance = 'v2', connected_event_converged_at = $3,
             generation = generation + 1, operator_id = $4, reason = $5,
             updated_at = $3
         WHERE environment = $1 AND generation = $2 AND state = 'open'
           AND connected_event_issuance = 'v1'
         RETURNING state, generation, connected_event_issuance, oauth_state_issuance,
                   connected_event_converged_at, oauth_state_converged_at,
                   v1_state_drain_not_before, v1_events_drained_at,
                   quiescing_at, closed_at, operator_id, reason, updated_at`,
        [input.now, input.operatorId, input.reason],
      ),

    advanceOauthStateIssuance: (input) =>
      updateControl(
        deps.pool,
        environment,
        input.expectedGeneration,
        `UPDATE legacy_import_control
         SET oauth_state_issuance = 'opaque-v2', oauth_state_converged_at = $3,
             v1_state_drain_not_before = $4, generation = generation + 1,
             operator_id = $5, reason = $6, updated_at = $3
         WHERE environment = $1 AND generation = $2 AND state = 'open'
           AND connected_event_issuance = 'v2' AND oauth_state_issuance = 'signed-v1'
         RETURNING state, generation, connected_event_issuance, oauth_state_issuance,
                   connected_event_converged_at, oauth_state_converged_at,
                   v1_state_drain_not_before, v1_events_drained_at,
                   quiescing_at, closed_at, operator_id, reason, updated_at`,
        [input.now, input.drainNotBefore, input.operatorId, input.reason],
      ),

    markV1EventsDrained: (input) =>
      updateControl(
        deps.pool,
        environment,
        input.expectedGeneration,
        `UPDATE legacy_import_control
         SET v1_events_drained_at = $3, generation = generation + 1,
             operator_id = $4, reason = $5, updated_at = $3
         WHERE environment = $1 AND generation = $2 AND state = 'open'
           AND oauth_state_issuance = 'opaque-v2' AND v1_events_drained_at IS NULL
         RETURNING state, generation, connected_event_issuance, oauth_state_issuance,
                   connected_event_converged_at, oauth_state_converged_at,
                   v1_state_drain_not_before, v1_events_drained_at,
                   quiescing_at, closed_at, operator_id, reason, updated_at`,
        [input.now, input.operatorId, input.reason],
      ),

    beginQuiescing: (input) =>
      updateControl(
        deps.pool,
        environment,
        input.expectedGeneration,
        `UPDATE legacy_import_control
         SET state = 'quiescing', quiescing_at = $3, generation = generation + 1,
             operator_id = $4, reason = $5, updated_at = $3
         WHERE environment = $1 AND generation = $2 AND state = 'open'
           AND oauth_state_issuance = 'opaque-v2'
           AND v1_events_drained_at IS NOT NULL
           AND v1_state_drain_not_before <= $3
         RETURNING state, generation, connected_event_issuance, oauth_state_issuance,
                   connected_event_converged_at, oauth_state_converged_at,
                   v1_state_drain_not_before, v1_events_drained_at,
                   quiescing_at, closed_at, operator_id, reason, updated_at`,
        [input.now, input.operatorId, input.reason],
      ),

    removeDormantLegacyQueueEntries: (input) =>
      inTransaction(deps.pool, async (client) => {
        const control = await client.query<ControlRow>(`${CONTROL_SELECT} FOR UPDATE`, [
          environment,
        ])
        const current = mapControl(control.rows[0])
        if (
          current.state !== 'quiescing' ||
          current.generation !== input.expectedGeneration
        ) {
          throw new Error(
            'legacy import control changed concurrently or is not quiescing',
          )
        }
        await removeDormantLegacyEntries(deps.defaultQueue)
      }),

    close: (input) =>
      updateControl(
        deps.pool,
        environment,
        input.expectedGeneration,
        `UPDATE legacy_import_control
         SET state = 'closed', closed_at = $3, generation = generation + 1,
             operator_id = $4, reason = $5, updated_at = $3
         WHERE environment = $1 AND generation = $2 AND state = 'quiescing'
         RETURNING state, generation, connected_event_issuance, oauth_state_issuance,
                   connected_event_converged_at, oauth_state_converged_at,
                   v1_state_drain_not_before, v1_events_drained_at,
                   quiescing_at, closed_at, operator_id, reason, updated_at`,
        [input.now, input.operatorId, input.reason],
      ),

    archiveTerminalRows: (input) =>
      inTransaction(deps.pool, (client) =>
        archiveTerminalRows(client, { ...input, environment }),
      ),
  }
}
