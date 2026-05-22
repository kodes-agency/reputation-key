// Integration context — property query port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the GBP cache repository to verify property ownership and resolve
// property IDs by connection — without the cache repo directly accessing
// the Property context's database tables.
// The implementation lives in the wiring layer (build.ts).

export type PropertyQueryPort = Readonly<{
  /** Check whether a property belongs to the given organization. */
  belongsToOrg: (propertyId: string, orgId: string) => Promise<boolean>

  /** Find all non-deleted property IDs linked to a Google connection within an org. */
  findIdsByGoogleConnection: (
    connectionId: string,
    orgId: string,
  ) => Promise<ReadonlyArray<string>>
}>
