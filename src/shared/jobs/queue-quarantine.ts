// QueueQuarantine — BQC-0.4 stop control: pause/resume a BullMQ queue
// WITHOUT deleting jobs.
//
// Containment must be reversible and evidence-preserving: pausing stops
// workers from picking up new work while every waiting/active/failed job
// stays in Redis. Never use obliterate/clean for containment.

/** Queues an operator may quarantine. Fail closed on anything else. */
export const QUARANTINE_QUEUE_NAMES = ['default', 'background', 'domain-events'] as const

export type QuarantineQueueName = (typeof QUARANTINE_QUEUE_NAMES)[number]

/** Minimal BullMQ surface the control needs (structural — Queue fits). */
export type QuarantineQueuePort = Readonly<{
  pause: () => Promise<void>
  resume: () => Promise<void>
  isPaused: () => Promise<boolean>
  getJobCounts: () => Promise<Record<string, number>>
  close: () => Promise<void>
}>

export type QuarantineResult = Readonly<{
  paused: boolean
  jobCounts: Record<string, number>
}>

/** Fail closed on typos/unknown queues — quarantine is a named-queue control. */
export function assertKnownQueueName(name: string): asserts name is QuarantineQueueName {
  if (!(QUARANTINE_QUEUE_NAMES as ReadonlyArray<string>).includes(name)) {
    throw new Error(
      `unknown queue "${name}" — expected one of: ${QUARANTINE_QUEUE_NAMES.join(', ')}`,
    )
  }
}

/** Pause processing. Jobs are preserved — counts are reported, never changed. */
export async function pauseQueueForQuarantine(
  queue: QuarantineQueuePort,
): Promise<QuarantineResult> {
  await queue.pause()
  return { paused: await queue.isPaused(), jobCounts: await queue.getJobCounts() }
}

/** Resume processing after quarantine. */
export async function resumeQueueFromQuarantine(
  queue: QuarantineQueuePort,
): Promise<QuarantineResult> {
  await queue.resume()
  return { paused: await queue.isPaused(), jobCounts: await queue.getJobCounts() }
}

/** Read-only status. */
export async function queueQuarantineStatus(
  queue: QuarantineQueuePort,
): Promise<QuarantineResult> {
  return { paused: await queue.isPaused(), jobCounts: await queue.getJobCounts() }
}
