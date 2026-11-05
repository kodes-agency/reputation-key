// Integration context — GBP queue port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Queue boundary for enqueuing async import jobs.

export type GoogleImportV2ItemJobData = Readonly<{
  jobId: string
  organizationId: string
  importJobId: string
  itemId: string
  retryRevision: number
}>

export type GoogleImportV2QueuePort = Readonly<{
  /**
   * One bounded addBulk call. Every entry carries a deterministic BullMQ ID,
   * so ambiguous relay delivery and concurrent consumers converge.
   */
  addImportItemJobs: (jobs: readonly GoogleImportV2ItemJobData[]) => Promise<void>
}>
