// What a context contributes to the manual rights script: the records of one
// Organization for an access request, and the purge of them for a closure. The
// script composes one executor per context; there is no registry and no
// generic exporter.

export type RightsExportFile = Readonly<{
  path: string
  mediaType: 'application/json'
  bytes: Uint8Array
}>

export type RightsPurgeOutcome = Readonly<{
  /** Rows deleted per table, in deletion order. */
  deleted: Readonly<Record<string, number>>
  /** Content-free line for the erasure record. */
  evidenceRef: string
}>

export type RightsExecutor = Readonly<{
  context: string
  /** Every record of the Organization the requester may receive. */
  access(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly RightsExportFile[]>
  /**
   * Fence, verify and delete in one transaction. Refuses an Organization that
   * is still active, so a closure always runs behind suspension.
   */
  purgeOrganization(
    input: Readonly<{ organizationId: string; occurredAt: Date }>,
  ): Promise<RightsPurgeOutcome>
}>
