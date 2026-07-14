// Job and schedule contracts — declarative definitions for the job runtime (PRE17A A2).
//
// Each context declares its job and schedule definitions. The JobRuntime
// validates uniqueness, creates queues/workers, registers schedulers, and
// manages lifecycle. Adding a new job requires only a new definition and
// composition registration — not editing src/worker/index.ts.

import type { z } from 'zod'
import type { JobHandler } from './registry'

// ── Queue classes ───────────────────────────────────────────────────

/**
 * Queue class determines which BullMQ queue a job is enqueued on.
 *
 * - `interactive`: User-triggered async actions (imports, reply publish).
 *   Protected from maintenance work. Higher concurrency.
 * - `background`: Cron-scheduled maintenance (metrics, reconciliation,
 *   retention). Lower concurrency, staggered dispatch.
 * - `domain-events`: Durable cross-context event dispatch (PRE17A A3).
 *   High enough to drain bursts; handler-level DB limits authoritative.
 */
export type QueueClass = 'interactive' | 'background' | 'domain-events'

// ── Content classification ──────────────────────────────────────────

/**
 * Telemetry content policy for a job. PRE17 jobs should be `identifier-only`
 * — review text, prompts, replies, and reviewer identity must never appear
 * in job names, logs, or metrics.
 */
export type ContentClassification = 'identifier-only' | 'internal' | 'restricted'

// ── Named retry policies ────────────────────────────────────────────

export type RetryPolicyName =
  | 'fast' // 3 attempts, 1s exponential backoff — transient blips
  | 'standard' // 3 attempts, 30s exponential backoff — DB/Redis instability
  | 'patient' // 5 attempts, 60s exponential backoff — external API rate limits
  | 'no-retry' // 1 attempt — fire-and-forget or externally idempotent

// ── Schedule definition ─────────────────────────────────────────────

export type ScheduleDefinition = Readonly<{
  /** Stable scheduler ID for deduplication (e.g., 'health-check-recurring'). */
  readonly schedulerId: string
  /** Cron pattern (e.g., '0 * * * *' for hourly) OR interval in ms. */
  readonly pattern?: string
  readonly every?: number
  /** Stagger window in ms — random jitter applied to avoid thundering herd. */
  readonly staggerMs?: number
}>

// ── Job definition ──────────────────────────────────────────────────

export type JobDefinition<T = unknown> = Readonly<{
  /** Owning context (e.g., 'review', 'metric', 'goal'). */
  readonly owner: string
  /** Job name — must be unique across all contexts. */
  readonly name: string
  /** Which queue this job runs on. */
  readonly queue: QueueClass
  /** Zod schema for the payload. Validated before enqueue and before consumption. */
  readonly payloadSchema?: z.ZodType<T>
  /** Handler function. */
  readonly handler: JobHandler<T>
  /** Named retry policy. */
  readonly retry: RetryPolicyName
  /** Max execution time in ms. */
  readonly timeoutMs?: number
  /** Max parallel executions per worker. */
  readonly concurrency?: number
  /** Whether the job can proceed without Redis (false = fatal if Redis down). */
  readonly redisRequired: boolean
  /** Telemetry content classification. */
  readonly content: ContentClassification
  /** Optional schedule — if set, the runtime registers a BullMQ Job Scheduler. */
  readonly schedule?: ScheduleDefinition
}>

// ── Job manifest ────────────────────────────────────────────────────

/**
 * A set of job definitions registered by a context.
 * Contexts export this from their build function.
 */
export type JobManifest = Readonly<{
  readonly context: string
  readonly jobs: readonly JobDefinition[]
}>
