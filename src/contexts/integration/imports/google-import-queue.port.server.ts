// Integration context — GBP queue port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Queue boundary for enqueuing async import jobs.

export type GoogleImportItemJobData = Readonly<{
  jobId: string
  organizationId: string
  importJobId: string
  itemId: string
  retryRevision: number
  dispatchEpoch: number
}>

export type GoogleImportQueuePort = Readonly<{
  /**
   * One bounded addBulk call. Every entry carries a deterministic BullMQ ID,
   * so ambiguous relay delivery and concurrent consumers converge.
   */
  addImportItemJobs: (jobs: readonly GoogleImportItemJobData[]) => Promise<void>
}>
