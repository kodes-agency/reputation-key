// Review context — queue port for BullMQ job dispatch
// Per architecture: "BullMQ job dispatch as cross-context mechanism."

// BullMQ serializes job data to JSON — branded types are just strings at runtime.
// Consumer (sync-property-reviews.job) re-brands via id constructors.
// Using string here avoids serialization overhead and keeps BullMQ dashboard readable.
export type SyncPropertyReviewsJobData = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}>

export type ReviewQueuePort = Readonly<{
  addSyncJob: (data: SyncPropertyReviewsJobData) => Promise<void>
}>
