// The one classifier for "this BullMQ job is a scheduler firing". The delayed
// execution gate authorizes a firing as a schedule, the failure quarantine does
// not dead-letter one, and the job-runtime report keeps a firing's failure apart
// from on-demand work; all must agree on which jobs those are.

/** The fields of a BullMQ job, live or read back from Redis, that tell a firing. */
export type ScheduleFiringCandidate = Readonly<{
  repeatJobKey?: string
}>

/** How a job came to run: fired by its scheduler, or enqueued on demand. */
export type JobExecutionKind = 'worker' | 'schedule'

/** BullMQ Job Scheduler firings carry the stable scheduler ID in repeatJobKey. */
export function isScheduleFiring(job: ScheduleFiringCandidate): boolean {
  return Boolean(job.repeatJobKey)
}

export function executionKindOf(job: ScheduleFiringCandidate): JobExecutionKind {
  return isScheduleFiring(job) ? 'schedule' : 'worker'
}
