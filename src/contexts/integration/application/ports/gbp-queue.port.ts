// Integration context — GBP queue port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Queue boundary for enqueuing async import jobs.

export type ImportPropertyJobData = Readonly<{
  jobId: string
  organizationId: string
  connectionId: string
  locations: ReadonlyArray<{
    gbpPlaceId: string
    businessName: string
    address: string | null
    primaryCategory: string | null
    gbpLocationName: string
    /** ISO country when known from GBP (BQR-3.5). */
    countryCode?: string | null
  }>
}>

export type GbpQueuePort = Readonly<{
  addBulkImportJob: (data: ImportPropertyJobData) => Promise<void>
}>
