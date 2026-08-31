// Review context — source-content lifecycle compatibility port (BQC-1.7).
// Ordinary composition performs bounded, checkpointed, content-free reports
// for disconnect/property/organization scopes. Erasure is possible only in a
// separately constructed executor carrying the exact confirmation plus a
// reviewed approval authorizer. The implementation lives in infrastructure.

export type SourcePurgeResult = Readonly<{
  subject: string
  batches: number
  rowsDeleted: number
  rowsRedacted: number
  /**
   * Present only when the adapter reached its bounded per-invocation budget.
   * Replaying this opaque, scope-bound checkpoint resumes the frozen window.
   */
  nextCheckpoint?:
    | import('../use-cases/run-source-content-lifecycle').ReviewSourceContentLifecycleCheckpoint
    | null
}>

export type SourcePurgeContinuation = Readonly<{
  checkpoint?: import('../use-cases/run-source-content-lifecycle').ReviewSourceContentLifecycleCheckpoint
}>

export type SourceContentPurge = Readonly<{
  /** Inspect/apply every Review sourced through the revoked connection. */
  forConnection: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    connectionId: string,
    continuation?: SourcePurgeContinuation,
  ) => Promise<SourcePurgeResult>
  /** Inspect/apply every Review for the Property. */
  forProperty: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
    continuation?: SourcePurgeContinuation,
  ) => Promise<SourcePurgeResult>
  /** Inspect/apply every Review across the Organization. */
  forOrganization: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    continuation?: SourcePurgeContinuation,
  ) => Promise<SourcePurgeResult>
  /** Property purge companion: inbox workflow rows for the property. */
  inboxForProperty: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
  ) => Promise<SourcePurgeResult>
}>
