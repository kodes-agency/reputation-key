// Integration context — GBP API port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// External API boundary for Google Business Profile operations.

import type { GbpLocation } from '../../domain/types'

export type GbpAccount = Readonly<{
  name: string
  accountName: string
  type: string
  role: string | null
}>

export type GbpApiPort = Readonly<{
  listAccounts: (accessToken: string) => Promise<ReadonlyArray<GbpAccount>>
  listLocations: (
    accessToken: string,
    accountName: string,
  ) => Promise<ReadonlyArray<GbpLocation>>
  getLocation: (accessToken: string, locationName: string) => Promise<GbpLocation>
  batchGetReviews: (
    accessToken: string,
    accountName: string,
    locationNames: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>>
}>
