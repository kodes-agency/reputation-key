// In-memory GbpQueuePort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GbpQueuePort,
  ImportPropertyJobData,
} from '#/contexts/integration/application/ports/gbp-queue.port'

// fallow-ignore-next-line unused-type
export type InMemoryGbpQueuePort = GbpQueuePort &
  Readonly<{
    enqueuedJobs: () => ReadonlyArray<ImportPropertyJobData>
    clear: () => void
  }>

export const createInMemoryGbpQueuePort = (): InMemoryGbpQueuePort => {
  const jobs: ImportPropertyJobData[] = []
  return {
    addBulkImportJob: async (data) => {
      jobs.push(data)
    },
    enqueuedJobs: () => [...jobs],
    clear: () => {
      jobs.length = 0
    },
  }
}
