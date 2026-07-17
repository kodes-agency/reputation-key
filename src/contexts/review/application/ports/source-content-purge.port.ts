// Review context — source-content lifecycle purge port (BQC-1.7).
// Bounded, retryable, evidenced erasure for disconnect and approved
// property/organization purge. Application code depends on this port;
// the implementation lives in review/infrastructure/.

export type SourcePurgeResult = Readonly<{
  subject: string
  batches: number
  rowsDeleted: number
}>

export type SourceContentPurge = Readonly<{
  /** Disconnect: every review sourced through the revoked connection. */
  forConnection: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    connectionId: string,
  ) => Promise<SourcePurgeResult>
  /** Approved property purge: every review for the property. */
  forProperty: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
  ) => Promise<SourcePurgeResult>
  /** Approved organization purge: every review across the organization. */
  forOrganization: (
    orgId: import('#/shared/domain/ids').OrganizationId,
  ) => Promise<SourcePurgeResult>
  /** Property purge companion: inbox workflow rows for the property. */
  inboxForProperty: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    propertyId: import('#/shared/domain/ids').PropertyId,
  ) => Promise<SourcePurgeResult>
}>
