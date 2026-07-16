// BullMQ queue depth snapshot for ops diagnostics (BQR-6.2).
// Identifier-only — no job payloads or PII.

export type QueueDepth = Readonly<{
  name: string
  waiting: number
  active: number
  delayed: number
  failed: number
  paused: number
}>

/** Minimal surface of BullMQ Queue used by depth reads (easy to mock). */
export type QueueCountsPort = Readonly<{
  getJobCounts: (
    ...types: Array<'waiting' | 'active' | 'delayed' | 'failed' | 'paused'>
  ) => Promise<Partial<Record<string, number>>>
}>

export async function readQueueDepth(
  name: string,
  queue: QueueCountsPort | null | undefined,
): Promise<QueueDepth | null> {
  if (!queue) return null
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'paused',
  )
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
