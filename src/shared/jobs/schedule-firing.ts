// The one classifier for "this BullMQ job is a scheduler firing". The delayed
// execution gate authorizes a firing as a schedule, and the failure quarantine
// does not dead-letter one; both must agree on which jobs those are.

import type { Job } from 'bullmq'

/**
 * BullMQ Job Scheduler firings carry the stable scheduler ID in repeatJobKey.
 * The jobId fallback keeps already-enqueued legacy repeat firings classified
 * correctly during the one-time reconciliation cutover.
 */
export function isScheduleFiring(job: Job): boolean {
  if (job.repeatJobKey) return true
  const stableId = job.opts?.jobId ?? job.id ?? ''
  return typeof stableId === 'string' && stableId.includes('-recurring')
}
