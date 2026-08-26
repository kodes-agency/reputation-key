import type { Pool } from 'pg'
import type { Job, Queue } from 'bullmq'

const EVENT_TYPE = 'identity.member.invited'
const QUEUE_PAGE_SIZE = 100

const INVITATION_FACT_BULL_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
  'paused',
  'completed',
  'failed',
] as const

export type InvitationFactContract = Readonly<{
  issuanceVersion: 1 | 2
  generation: number
  switchedAt: Date | null
  verifiedAt: Date | null
  operatorId: string | null
  reason: string | null
  updatedAt: Date
}>

export type InvitationFactJob = Readonly<{
  id?: string
  name: string
  data: unknown
  failedReason?: string
  stacktrace?: readonly string[] | null
  getLogs(): Promise<readonly string[]>
  updateData(data: unknown): Promise<void>
  updateErrorMetadata(
    input: Readonly<{ failedReason: string; stacktrace: readonly string[] }>,
  ): Promise<void>
  replaceLogs(logs: readonly string[]): Promise<void>
}>

export type InvitationFactQueue = Readonly<{
  isPaused(): Promise<boolean>
  getJobCounts(...types: string[]): Promise<Record<string, number>>
  getJobs(
    types: readonly string[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<readonly InvitationFactJob[]>
}>

export type InvitationFactContractDeps = Readonly<{
  pool: Pool
  defaultQueue: InvitationFactQueue
  domainEventsQueue: InvitationFactQueue
  quarantineQueue: InvitationFactQueue
}>

export type InvitationFactInspection = Readonly<{
  contract: InvitationFactContract
  queues: Readonly<{
    default: Readonly<QueueInspection & { paused: boolean; active: number }>
    domainEvents: Readonly<QueueInspection & { paused: boolean; active: number }>
    quarantine: QueueInspection
  }>
  postgres: Readonly<{
    outbox: number
    activity: number
    privacyDirty: number
    compatibilityV1: number
  }>
  /** All remaining rewrite work, including content-free compatibility-v1 copies. */
  totalDirty: number
  /** Retained copies containing an address/private detail in data or error metadata. */
  privacyDirty: number
  /** Content-free v1 envelopes still blocking the later schema contraction. */
  compatibilityV1: number
}>

type QueueInspection = Readonly<{
  dirty: number
  privacyDirty: number
  compatibilityV1: number
}>

export type InvitationFactScrubError = Readonly<{
  target: keyof InvitationFactScrubResult['changed']
  code: 'mutation_failed'
  /** Content-free exception class only; never persist or print its message. */
  errorName: string
}>

export type InvitationFactScrubResult = Readonly<{
  applied: boolean
  batchSize: number
  changed: Readonly<{
    outbox: number
    activity: number
    defaultQueue: number
    domainEventsQueue: number
    quarantineQueue: number
  }>
  changedTotal: number
  errorCount: number
  errors: readonly InvitationFactScrubError[]
  /** Rerun until zero; each target predicate is its durable restart checkpoint. */
  rerunRequired: boolean
}>

type ControlRow = Readonly<{
  issuance_version: number
  generation: string | number
  switched_at: Date | null
  verified_at: Date | null
  operator_id: string | null
  reason: string | null
  updated_at: Date
}>

type QueueRole = 'default' | 'domain-events' | 'quarantine'

function adaptJob(queue: Queue, job: Job): InvitationFactJob {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    getLogs: async () => {
      if (!job.id) return []
      return (await queue.getJobLogs(job.id)).logs
    },
    updateData: (data) => job.updateData(data),
    updateErrorMetadata: async ({ failedReason, stacktrace }) => {
      if (!job.id) throw new Error('BullMQ invitation fact job is missing its id')
      const client = await queue.client
      await client.hset(queue.toKey(job.id), {
        failedReason,
        stacktrace: JSON.stringify(stacktrace),
      })
    },
    replaceLogs: async (logs) => {
      await job.clearLogs()
      for (const log of logs) await job.log(log)
    },
  }
}

/** Bind BullMQ's job/error/log stores to the narrow operator lifecycle port. */
export function createInvitationFactQueueAdapter(queue: Queue): InvitationFactQueue {
  return {
    isPaused: () => queue.isPaused(),
    getJobCounts: (...types) =>
      queue.getJobCounts(...(types as Parameters<Queue['getJobCounts']>)),
    getJobs: async (types, start, end, asc) =>
      (
        await queue.getJobs(types as Parameters<Queue['getJobs']>[0], start, end, asc)
      ).map((job) => adaptJob(queue, job)),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapControl(row: ControlRow | undefined): InvitationFactContract {
  if (!row) throw new Error('identity invitation fact contract row is missing')
  const generation = Number(row.generation)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('identity invitation fact contract generation is invalid')
  }
  if (row.issuance_version !== 1 && row.issuance_version !== 2) {
    throw new Error('identity invitation fact contract issuance version is invalid')
  }
  return {
    issuanceVersion: row.issuance_version,
    generation,
    switchedAt: row.switched_at,
    verifiedAt: row.verified_at,
    operatorId: row.operator_id,
    reason: row.reason,
    updatedAt: row.updated_at,
  }
}

async function readContract(pool: Pool): Promise<InvitationFactContract> {
  const result = await pool.query<ControlRow>(`
    SELECT issuance_version, generation, switched_at, verified_at,
           operator_id, reason, updated_at
    FROM identity_invitation_fact_contract
    WHERE singleton = true`)
  return mapControl(result.rows[0])
}

function redactActivityData(data: unknown): unknown {
  if (!isRecord(data) || data.action !== 'invited' || data.resourceType !== 'member') {
    return data
  }
  if (!isRecord(data.payload) || data.payload.detail == null) return data
  return { ...data, payload: { ...data.payload, detail: null } }
}

const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu

function redactSensitiveText(text: string, secrets: readonly string[]): string {
  let clean = text
  for (const secret of secrets) {
    if (secret && secret !== '[redacted]') clean = clean.split(secret).join('[redacted]')
  }
  return clean.replace(EMAIL_LIKE, '[redacted]')
}

function privateValuesFromTarget(jobName: string, data: unknown): readonly string[] {
  if (!isRecord(data)) return []
  if (
    jobName === 'insert-activity-log' &&
    data.action === 'invited' &&
    data.resourceType === 'member' &&
    isRecord(data.payload) &&
    typeof data.payload.detail === 'string' &&
    data.payload.detail !== '[redacted]'
  ) {
    return [data.payload.detail]
  }
  if (
    jobName === EVENT_TYPE &&
    ((data.eventType === EVENT_TYPE &&
      isRecord(data.payload) &&
      typeof data.payload.email === 'string' &&
      data.payload.email !== '[redacted]') ||
      (data.eventType !== EVENT_TYPE &&
        typeof data.email === 'string' &&
        data.email !== '[redacted]'))
  ) {
    return [
      data.eventType === EVENT_TYPE &&
      isRecord(data.payload) &&
      typeof data.payload.email === 'string'
        ? data.payload.email
        : (data.email as string),
    ]
  }
  return []
}

function isInvitationTarget(jobName: string, data: unknown): boolean {
  if (!isRecord(data)) return false
  return (
    (jobName === 'insert-activity-log' &&
      data.action === 'invited' &&
      data.resourceType === 'member') ||
    jobName === EVENT_TYPE
  )
}

function hasPrivateTargetData(jobName: string, data: unknown): boolean {
  if (!isRecord(data)) return false
  if (
    jobName === 'insert-activity-log' &&
    data.action === 'invited' &&
    data.resourceType === 'member' &&
    isRecord(data.payload)
  ) {
    return data.payload.detail != null && data.payload.detail !== '[redacted]'
  }
  if (jobName === EVENT_TYPE) {
    if (data.eventType === EVENT_TYPE && isRecord(data.payload)) {
      return 'email' in data.payload && data.payload.email !== '[redacted]'
    }
    return 'email' in data && data.email !== '[redacted]'
  }
  return false
}

function isCompatibilityV1Target(jobName: string, data: unknown): boolean {
  return (
    jobName === EVENT_TYPE &&
    isRecord(data) &&
    (data.eventType !== EVENT_TYPE || data.eventVersion !== 2)
  )
}

function redactEventData(data: unknown): unknown {
  if (!isRecord(data)) return data
  if (data.eventType !== EVENT_TYPE) {
    if (!('email' in data)) return data
    const { email: _email, ...bare } = data
    return bare
  }
  if (!isRecord(data.payload)) return data
  if (data.eventVersion === 2 && !('email' in data.payload)) return data
  const { email: _email, ...payload } = data.payload
  return { ...data, eventVersion: 2, payload }
}

/** Exact-shape redaction only; unrelated jobs and fields are never rewritten. */
export function redactIdentityInvitationJobData(
  queueRole: QueueRole,
  jobName: string,
  data: unknown,
): unknown {
  if (queueRole === 'default') {
    return jobName === 'insert-activity-log' ? redactActivityData(data) : data
  }
  if (queueRole === 'domain-events') {
    return jobName === EVENT_TYPE ? redactEventData(data) : data
  }
  if (!isRecord(data) || !('data' in data)) return data
  const secrets = privateValuesFromTarget(jobName, data.data)
  const nested =
    jobName === 'insert-activity-log'
      ? redactActivityData(data.data)
      : jobName === EVENT_TYPE
        ? redactEventData(data.data)
        : data.data
  const failedReason =
    typeof data.failedReason === 'string'
      ? redactSensitiveText(data.failedReason, secrets)
      : data.failedReason
  return nested === data.data && failedReason === data.failedReason
    ? data
    : { ...data, data: nested, failedReason }
}

function jobPrivateValues(
  role: QueueRole,
  jobName: string,
  data: unknown,
): readonly string[] {
  if (role === 'quarantine' && isRecord(data) && 'data' in data) {
    return privateValuesFromTarget(jobName, data.data)
  }
  return privateValuesFromTarget(jobName, data)
}

function hasPrivateJobData(role: QueueRole, jobName: string, data: unknown): boolean {
  if (role === 'quarantine' && isRecord(data) && 'data' in data) {
    const nestedPrivate = hasPrivateTargetData(jobName, data.data)
    const secrets = privateValuesFromTarget(jobName, data.data)
    const failurePrivate =
      typeof data.failedReason === 'string' &&
      redactSensitiveText(data.failedReason, secrets) !== data.failedReason
    return nestedPrivate || failurePrivate
  }
  return hasPrivateTargetData(jobName, data)
}

function isCompatibilityV1Job(role: QueueRole, jobName: string, data: unknown): boolean {
  if (role === 'quarantine' && isRecord(data) && 'data' in data) {
    return isCompatibilityV1Target(jobName, data.data)
  }
  return isCompatibilityV1Target(jobName, data)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  )
}

type JobInspection = Readonly<{
  cleanData: unknown
  cleanFailedReason: string
  cleanStacktrace: readonly string[]
  cleanLogs: readonly string[]
  dataDirty: boolean
  errorMetadataDirty: boolean
  logsDirty: boolean
  dirty: boolean
  privacyDirty: boolean
  compatibilityV1: boolean
}>

async function inspectJob(
  role: QueueRole,
  job: InvitationFactJob,
): Promise<JobInspection> {
  const targetData =
    role === 'quarantine' && isRecord(job.data) && 'data' in job.data
      ? job.data.data
      : job.data
  if (!isInvitationTarget(job.name, targetData)) {
    return {
      cleanData: job.data,
      cleanFailedReason: job.failedReason ?? '',
      cleanStacktrace: job.stacktrace ?? [],
      cleanLogs: [],
      dataDirty: false,
      errorMetadataDirty: false,
      logsDirty: false,
      dirty: false,
      privacyDirty: false,
      compatibilityV1: false,
    }
  }
  const cleanData = redactIdentityInvitationJobData(role, job.name, job.data)
  const secrets = jobPrivateValues(role, job.name, job.data)
  const failedReason = job.failedReason ?? ''
  const stacktrace = job.stacktrace ?? []
  const logs = await job.getLogs()
  const cleanFailedReason = redactSensitiveText(failedReason, secrets)
  const cleanStacktrace = stacktrace.map((line) => redactSensitiveText(line, secrets))
  const cleanLogs = logs.map((line) => redactSensitiveText(line, secrets))
  const errorMetadataDirty =
    cleanFailedReason !== failedReason || !sameStrings(cleanStacktrace, stacktrace)
  const logsDirty = !sameStrings(cleanLogs, logs)
  const dataDirty = cleanData !== job.data
  return {
    cleanData,
    cleanFailedReason,
    cleanStacktrace,
    cleanLogs,
    dataDirty,
    errorMetadataDirty,
    logsDirty,
    dirty: dataDirty || errorMetadataDirty || logsDirty,
    privacyDirty:
      hasPrivateJobData(role, job.name, job.data) || errorMetadataDirty || logsDirty,
    compatibilityV1: isCompatibilityV1Job(role, job.name, job.data),
  }
}

async function queueStatus(queue: InvitationFactQueue) {
  const [paused, counts] = await Promise.all([
    queue.isPaused(),
    queue.getJobCounts('active'),
  ])
  return { paused, active: counts.active ?? 0 }
}

async function scanQueue(
  queue: InvitationFactQueue,
  role: QueueRole,
  limit: number,
  apply: boolean,
): Promise<QueueInspection> {
  const inspection = { dirty: 0, privacyDirty: 0, compatibilityV1: 0 }
  const seenJobIds = new Set<string>()
  if (limit < 1) return inspection
  try {
    for (const state of INVITATION_FACT_BULL_STATES) {
      for (let start = 0; ; start += QUEUE_PAGE_SIZE) {
        const jobs = await queue.getJobs(
          [state],
          start,
          start + QUEUE_PAGE_SIZE - 1,
          true,
        )
        for (const job of jobs) {
          if (job.id && seenJobIds.has(job.id)) continue
          if (job.id) seenJobIds.add(job.id)
          const result = await inspectJob(role, job)
          if (result.compatibilityV1) inspection.compatibilityV1++
          if (!result.dirty) continue
          if (apply) {
            if (result.dataDirty) await job.updateData(result.cleanData)
            if (result.errorMetadataDirty) {
              await job.updateErrorMetadata({
                failedReason: result.cleanFailedReason,
                stacktrace: result.cleanStacktrace,
              })
            }
            if (result.logsDirty) await job.replaceLogs(result.cleanLogs)
          }
          inspection.dirty++
          if (result.privacyDirty) inspection.privacyDirty++
          if (inspection.dirty >= limit) return inspection
        }
        if (jobs.length < QUEUE_PAGE_SIZE) break
      }
    }
  } catch (error) {
    throw new QueueScanFailure(inspection, error)
  }
  return inspection
}

class QueueScanFailure extends Error {
  readonly inspection: QueueInspection
  readonly original: unknown

  constructor(inspection: QueueInspection, original: unknown) {
    super('identity invitation fact queue scan failed')
    this.name = 'QueueScanFailure'
    this.inspection = inspection
    this.original = original
  }
}

async function postgresDirtyCounts(pool: Pool): Promise<{
  outbox: number
  activity: number
  privacyDirty: number
  compatibilityV1: number
}> {
  const result = await pool.query<{
    outbox: string
    activity: string
    privacy_dirty: string
    compatibility_v1: string
  }>(`
    SELECT
      (SELECT count(*)::bigint
       FROM outbox_events
       WHERE event_type = '${EVENT_TYPE}'
         AND (event_version <> 2 OR payload ? 'email')) AS outbox,
      (SELECT count(*)::bigint
       FROM activity_log
       WHERE action = 'invited' AND resource_type = 'member'
         AND payload ->> 'detail' IS NOT NULL) AS activity,
      ((SELECT count(*)::bigint
        FROM outbox_events
        WHERE event_type = '${EVENT_TYPE}'
          AND payload ? 'email'
          AND payload ->> 'email' IS DISTINCT FROM '[redacted]')
       +
       (SELECT count(*)::bigint
        FROM activity_log
        WHERE action = 'invited' AND resource_type = 'member'
          AND payload ->> 'detail' IS NOT NULL
          AND payload ->> 'detail' IS DISTINCT FROM '[redacted]')) AS privacy_dirty,
      (SELECT count(*)::bigint
       FROM outbox_events
       WHERE event_type = '${EVENT_TYPE}' AND event_version <> 2) AS compatibility_v1`)
  return {
    outbox: Number(result.rows[0]?.outbox ?? 0),
    activity: Number(result.rows[0]?.activity ?? 0),
    privacyDirty: Number(result.rows[0]?.privacy_dirty ?? 0),
    compatibilityV1: Number(result.rows[0]?.compatibility_v1 ?? 0),
  }
}

async function assertQueuesQuiesced(deps: InvitationFactContractDeps): Promise<void> {
  const [defaultStatus, domainStatus] = await Promise.all([
    queueStatus(deps.defaultQueue),
    queueStatus(deps.domainEventsQueue),
  ])
  const blockers: string[] = []
  if (!defaultStatus.paused) blockers.push('default_queue_not_paused')
  if (defaultStatus.active > 0) blockers.push('default_queue_active')
  if (!domainStatus.paused) blockers.push('domain_events_queue_not_paused')
  if (domainStatus.active > 0) blockers.push('domain_events_queue_active')
  if (blockers.length > 0) {
    throw new Error(`invitation fact lifecycle blocked: ${blockers.join(',')}`)
  }
}

function assertMutation(input: Readonly<{ operatorId: string; reason: string }>): void {
  if (!input.operatorId.trim()) throw new Error('operatorId is required')
  if (!input.reason.trim()) throw new Error('reason is required')
}

async function updateContract(
  deps: InvitationFactContractDeps,
  input: Readonly<{ operatorId: string; reason: string }>,
  transition: 'v2' | 'v1' | 'verified',
): Promise<InvitationFactContract> {
  assertMutation(input)
  await assertQueuesQuiesced(deps)
  const current = await readContract(deps.pool)
  if (transition === 'v2' && current.issuanceVersion === 2) return current
  if (transition === 'v1' && current.issuanceVersion === 1) return current
  if (transition === 'verified' && current.verifiedAt) return current
  if (transition === 'v1' && current.verifiedAt) {
    throw new Error('verified invitation fact contract cannot roll back to v1')
  }
  if (transition === 'verified') {
    if (current.issuanceVersion !== 2) {
      throw new Error('invitation fact issuance is not v2')
    }
    const inspection = await inspectIdentityInvitationFactContract(deps)
    if (inspection.privacyDirty > 0) {
      throw new Error(
        `invitation fact privacy verification blocked: ${inspection.privacyDirty} retained copies`,
      )
    }
  }

  const result = await deps.pool.query<ControlRow>(
    transition === 'v2'
      ? `UPDATE identity_invitation_fact_contract
         SET issuance_version = 2, generation = generation + 1,
             switched_at = now(), operator_id = $2, reason = $3, updated_at = now()
         WHERE singleton = true AND generation = $1 AND issuance_version = 1
         RETURNING issuance_version, generation, switched_at, verified_at,
                   operator_id, reason, updated_at`
      : transition === 'v1'
        ? `UPDATE identity_invitation_fact_contract
           SET issuance_version = 1, generation = generation + 1,
               switched_at = NULL, verified_at = NULL,
               operator_id = $2, reason = $3, updated_at = now()
           WHERE singleton = true AND generation = $1 AND issuance_version = 2
                 AND verified_at IS NULL
           RETURNING issuance_version, generation, switched_at, verified_at,
                     operator_id, reason, updated_at`
        : `UPDATE identity_invitation_fact_contract
           SET verified_at = now(), generation = generation + 1,
               operator_id = $2, reason = $3, updated_at = now()
           WHERE singleton = true AND generation = $1 AND issuance_version = 2
                 AND verified_at IS NULL
           RETURNING issuance_version, generation, switched_at, verified_at,
                     operator_id, reason, updated_at`,
    [current.generation, input.operatorId, input.reason],
  )
  if (result.rowCount !== 1) {
    throw new Error('identity invitation fact contract changed concurrently')
  }
  return mapControl(result.rows[0])
}

async function scrubOutbox(pool: Pool, limit: number, apply: boolean): Promise<number> {
  if (limit < 1) return 0
  if (!apply) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::bigint AS count FROM (
         SELECT id FROM outbox_events
         WHERE event_type = $1 AND (event_version <> 2 OR payload ? 'email')
         ORDER BY id LIMIT $2
       ) candidates`,
      [EVENT_TYPE, limit],
    )
    return Number(result.rows[0]?.count ?? 0)
  }
  const result = await pool.query(
    `WITH candidates AS (
       SELECT id FROM outbox_events
       WHERE event_type = $1 AND (event_version <> 2 OR payload ? 'email')
       ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     UPDATE outbox_events event
     SET event_version = 2, payload = event.payload - 'email'
     FROM candidates WHERE event.id = candidates.id`,
    [EVENT_TYPE, limit],
  )
  return result.rowCount ?? 0
}

async function scrubActivity(pool: Pool, limit: number, apply: boolean): Promise<number> {
  if (limit < 1) return 0
  if (!apply) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::bigint AS count FROM (
         SELECT id FROM activity_log
         WHERE action = 'invited' AND resource_type = 'member'
           AND payload ->> 'detail' IS NOT NULL
         ORDER BY id LIMIT $1
       ) candidates`,
      [limit],
    )
    return Number(result.rows[0]?.count ?? 0)
  }
  const result = await pool.query(
    `WITH candidates AS (
       SELECT id FROM activity_log
       WHERE action = 'invited' AND resource_type = 'member'
         AND payload ->> 'detail' IS NOT NULL
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE activity_log activity
     SET payload = jsonb_set(activity.payload, '{detail}', 'null'::jsonb, true)
     FROM candidates WHERE activity.id = candidates.id`,
    [limit],
  )
  return result.rowCount ?? 0
}

export async function inspectIdentityInvitationFactContract(
  deps: InvitationFactContractDeps,
): Promise<InvitationFactInspection> {
  const [
    contract,
    postgres,
    defaultStatus,
    domainStatus,
    defaultDirty,
    domainDirty,
    quarantineDirty,
  ] = await Promise.all([
    readContract(deps.pool),
    postgresDirtyCounts(deps.pool),
    queueStatus(deps.defaultQueue),
    queueStatus(deps.domainEventsQueue),
    scanQueue(deps.defaultQueue, 'default', Number.POSITIVE_INFINITY, false),
    scanQueue(deps.domainEventsQueue, 'domain-events', Number.POSITIVE_INFINITY, false),
    scanQueue(deps.quarantineQueue, 'quarantine', Number.POSITIVE_INFINITY, false),
  ])
  const totalDirty =
    postgres.outbox +
    postgres.activity +
    defaultDirty.dirty +
    domainDirty.dirty +
    quarantineDirty.dirty
  const privacyDirty =
    postgres.privacyDirty +
    defaultDirty.privacyDirty +
    domainDirty.privacyDirty +
    quarantineDirty.privacyDirty
  const compatibilityV1 =
    postgres.compatibilityV1 +
    defaultDirty.compatibilityV1 +
    domainDirty.compatibilityV1 +
    quarantineDirty.compatibilityV1
  return {
    contract,
    postgres,
    queues: {
      default: { ...defaultStatus, ...defaultDirty },
      domainEvents: { ...domainStatus, ...domainDirty },
      quarantine: quarantineDirty,
    },
    totalDirty,
    privacyDirty,
    compatibilityV1,
  }
}

export async function scrubIdentityInvitationFactContract(
  deps: InvitationFactContractDeps,
  options: Readonly<{ batchSize: number; apply: boolean }>,
): Promise<InvitationFactScrubResult> {
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1) {
    throw new Error('batchSize must be a positive safe integer')
  }
  await assertQueuesQuiesced(deps)
  const contract = await readContract(deps.pool)
  if (contract.issuanceVersion !== 2) {
    throw new Error('invitation fact issuance must switch to v2 before scrubbing')
  }

  type ScrubTarget = keyof InvitationFactScrubResult['changed']
  const changed: Record<ScrubTarget, number> = {
    outbox: 0,
    activity: 0,
    defaultQueue: 0,
    domainEventsQueue: 0,
    quarantineQueue: 0,
  }
  const errors: InvitationFactScrubError[] = []
  let remaining = options.batchSize

  const safeErrorName = (error: unknown): string => {
    const original = error instanceof QueueScanFailure ? error.original : error
    const name = original instanceof Error ? original.name : 'UnknownError'
    return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'UnknownError'
  }
  const runTarget = async (
    target: ScrubTarget,
    work: () => Promise<number | QueueInspection>,
  ): Promise<boolean> => {
    if (remaining < 1) return true
    try {
      const result = await work()
      const count = typeof result === 'number' ? result : result.dirty
      changed[target] = count
      remaining -= count
      return true
    } catch (error) {
      const completed = error instanceof QueueScanFailure ? error.inspection.dirty : 0
      changed[target] = completed
      remaining -= completed
      errors.push({ target, code: 'mutation_failed', errorName: safeErrorName(error) })
      return false
    }
  }

  let healthy = await runTarget('outbox', () =>
    scrubOutbox(deps.pool, remaining, options.apply),
  )
  if (healthy) {
    healthy = await runTarget('activity', () =>
      scrubActivity(deps.pool, remaining, options.apply),
    )
  }
  if (healthy) {
    healthy = await runTarget('defaultQueue', () =>
      scanQueue(deps.defaultQueue, 'default', remaining, options.apply),
    )
  }
  if (healthy) {
    healthy = await runTarget('domainEventsQueue', () =>
      scanQueue(deps.domainEventsQueue, 'domain-events', remaining, options.apply),
    )
  }
  if (healthy) {
    await runTarget('quarantineQueue', () =>
      scanQueue(deps.quarantineQueue, 'quarantine', remaining, options.apply),
    )
  }
  const changedTotal = Object.values(changed).reduce((sum, count) => sum + count, 0)
  return {
    applied: options.apply,
    batchSize: options.batchSize,
    changed,
    changedTotal,
    errorCount: errors.length,
    errors,
    rerunRequired: errors.length > 0 || changedTotal === options.batchSize,
  }
}

export const switchIdentityInvitationFactToV2 = (
  deps: InvitationFactContractDeps,
  input: Readonly<{ operatorId: string; reason: string }>,
) => updateContract(deps, input, 'v2')

// fallow-ignore-next-line unused-export -- production consumer is the scripts/ops entry point (outside Fallow's src graph)
export const rollbackIdentityInvitationFactToV1 = (
  deps: InvitationFactContractDeps,
  input: Readonly<{ operatorId: string; reason: string }>,
) => updateContract(deps, input, 'v1')

export const verifyIdentityInvitationFactContract = (
  deps: InvitationFactContractDeps,
  input: Readonly<{ operatorId: string; reason: string }>,
) => updateContract(deps, input, 'verified')
