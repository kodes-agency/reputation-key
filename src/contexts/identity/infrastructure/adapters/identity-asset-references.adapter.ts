// Identity context — what still points at an uploaded avatar or logo.
//
// Better Auth owns the `user` and `organization` rows; Identity reads them. An
// object is referenced while the row it is scoped to still holds its address.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organization, user } from '#/shared/db/schema/auth'
import {
  identityAssetPath,
  parseIdentityAssetKey,
} from '../../application/identity-assets'

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

export const createIdentityAssetReferences = (
  db: Database,
): IdentityAssetReferencesPort => ({
  isReferenced: async (key) => {
    const parsed = parseIdentityAssetKey(key)
    if (!parsed) return false
    const address = identityAssetPath(key)

    if (parsed.kind === 'avatar') {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, parsed.ownerId), eq(user.image, address)))
        .limit(1)
      return rows.length > 0
    }

    const rows = await db
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.id, parsed.ownerId), eq(organization.logo, address)))
      .limit(1)
    return rows.length > 0
  },

  currentUserImage: async (userId) => {
    const rows = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return rows[0]?.image ?? null
  },

  currentOrganizationLogo: async (organizationId) => {
    const rows = await db
      .select({ logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    return rows[0]?.logo ?? null
  },
})
