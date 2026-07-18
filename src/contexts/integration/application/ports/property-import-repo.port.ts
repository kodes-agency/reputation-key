// Integration context — property import repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the import-property use case to create/query properties during GBP import.
// The implementation lives in infrastructure and is wired in build.ts.

/** Tagged error thrown when a unique-constraint violation occurs on insert (e.g. duplicate gbpPlaceId). */
export type DuplicateKeyError = Readonly<{
  _tag: 'DuplicateKeyError'
  code: 'duplicate_key'
  message: string
}>

export const duplicateKeyError = (message: string): DuplicateKeyError => ({
  _tag: 'DuplicateKeyError',
  code: 'duplicate_key',
  message,
})

export const isDuplicateKeyError = (e: unknown): e is DuplicateKeyError =>
  typeof e === 'object' &&
  e !== null &&
  (e as DuplicateKeyError)._tag === 'DuplicateKeyError'

export type PropertyImportRepo = Readonly<{
  /** Insert a new property and return it with its generated id. */
  insertProperty: (input: {
    organizationId: string
    name: string
    slug: string
    gbpPlaceId: string
    googleConnectionId: string
    /** ISO country from GBP when known (BQR-3.5). */
    countryCode?: string | null
    /**
     * GBP location resource name — the property side emits it on
     * property.created as the initial-sync trigger only when the resolved
     * region is processable (BQC-4.1 / ADR 0048).
     */
    gbpLocationName?: string
  }) => Promise<{
    id: string
    organizationId: string
    name: string
    slug: string
    gbpPlaceId: string | null
    createdAt: Date | null
  }>

  /** Find existing non-deleted property gbpPlaceIds for the given organization. */
  findExistingGbpPlaceIds: (
    organizationId: string,
    gbpPlaceIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<string>>

  /** Check if a property with this gbpPlaceId exists (for race-condition recovery). */
  existsByGbpPlaceId: (organizationId: string, gbpPlaceId: string) => Promise<boolean>
  /**
   * Count non-deleted properties linked to a Google connection (for Pub/Sub
   * lifecycle 0→1 detection — subscribe on the connection's first property).
   */
  countByGoogleConnectionId: (
    organizationId: string,
    connectionId: string,
  ) => Promise<number>
}>
