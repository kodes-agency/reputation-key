// Identity context — what still points at an uploaded avatar or logo.
//
// An object in the bucket is shown only while a user's image or an
// organization's logo still names it. That is what takes a replaced picture, an
// erased user's photo and a purged organization's logo off the public route
// without a deletion job.

export type IdentityAssetReferencesPort = Readonly<{
  /**
   * True when the user the key is scoped to still has it as their image, or the
   * organization it is scoped to still has it as its logo and has not entered
   * the irreversible part of closure. False for any other key, including one
   * that was uploaded and never saved.
   */
  isReferenced: (key: string) => Promise<boolean>
  /** The stored image address of a user, or null. */
  currentUserImage: (userId: string) => Promise<string | null>
  /** The stored logo address of an organization, or null. */
  currentOrganizationLogo: (organizationId: string) => Promise<string | null>
}>
