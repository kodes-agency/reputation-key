// Integration context — GBP API port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// External API boundary for Google Business Profile operations.

import type { GbpLocation } from '../../domain/types'

export type GbpApiPort = Readonly<{
  listLocations: (accessToken: string, accountName: string) => Promise<ReadonlyArray<GbpLocation>>
  getLocation: (accessToken: string, accountName: string, locationName: string) => Promise<GbpLocation>
  batchGetReviews: (accessToken: string, accountName: string, locationNames: ReadonlyArray<string>) => Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>>
}>
