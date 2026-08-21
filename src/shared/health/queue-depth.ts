// BullMQ queue depth snapshot for ops diagnostics (BQR-6.2).
// Identifier-only — no job payloads or PII.

import type { JobType } from 'bullmq'

export type QueueDepth = Readonly<{
  name: string
  waiting: number
  active: number
  delayed: number
  failed: number
  paused: number
}>

/**
 * Minimal surface of BullMQ Queue used by depth reads (easy to mock).
 *
 * `types` is BullMQ's own `JobType` rather than a hand-written union. The union
 * is library-owned and moves between majors — bullmq 6 dropped `'paused'` from
 * it — so restating it here only buys a copy that goes stale on the next bump.
 * Same type as the sibling port in `shared/observability/health-metrics.ts`.
 *
 * The result stays `Partial<...>`: BullMQ returns a count for each *requested*
 * type and nothing for the rest, so every read must tolerate a missing key.
 */
export type QueueCountsPort = Readonly<{
  getJobCounts: (...types: JobType[]) => Promise<Partial<Record<string, number>>>
}>

export async function readQueueDepth(
  name: string,
  queue: QueueCountsPort | null | undefined,
): Promise<QueueDepth | null> {
  if (!queue) return null
  // 'paused' is deliberately NOT requested: bullmq 6 removed the paused job
  // state, so it is no longer a JobType. Pausing is a queue-level flag there
  // and paused jobs stay counted in `waiting`. The `paused` field below is
  // kept — it is part of the published metrics schema (QUEUE_DEPTH_STATES),
  // and a backend that does expose a paused bucket still reports through it.
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
  return {
    name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    paused: counts.paused ?? 0,
  }
}

export async function readAllQueueDepths(
  queues: ReadonlyArray<
    Readonly<{ name: string; queue: QueueCountsPort | null | undefined }>
  >,
): Promise<ReadonlyArray<QueueDepth>> {
  const rows = await Promise.all(
    queues.map(({ name, queue }) => readQueueDepth(name, queue)),
  )
  return rows.filter((r): r is QueueDepth => r != null)
}
