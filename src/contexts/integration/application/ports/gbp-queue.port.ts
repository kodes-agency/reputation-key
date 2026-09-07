// Integration context — GBP queue port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Queue boundary for enqueuing async import jobs.

import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'

export type ImportPropertyJobData = JobEnqueueAttribution &
  Readonly<{
    jobId: string
    organizationId: string
    connectionId: string
    locations: ReadonlyArray<{
      gbpLocationId: string
      businessName: string
      address: string | null
      primaryCategory: string | null
      gbpLocationName: string
      /** ISO country when known from GBP (BQR-3.5). */
      countryCode?: string | null
    }>
  }>

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

export type GbpQueuePort = Readonly<{
  addBulkImportJob: (data: ImportPropertyJobData) => Promise<void>
}>
