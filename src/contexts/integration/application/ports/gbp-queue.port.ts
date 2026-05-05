// Integration context — GBP queue port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Queue boundary for enqueuing async import jobs.

import type { GbpImportJobId } from '#/shared/domain/ids'

export type GbpQueuePort = Readonly<{
  addBulkImportJob: (importJobId: GbpImportJobId) => Promise<void>
}>
