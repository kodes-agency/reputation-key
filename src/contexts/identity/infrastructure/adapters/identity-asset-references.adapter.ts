// Identity context — what still points at an uploaded avatar or logo.
//
// Better Auth owns the `user` and `organization` rows; Identity reads them. An
// object is referenced while the row it is scoped to still holds its address.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organization, user } from '#/shared/db/schema/auth'
import type { IdentityAssetReferencesPort } from '../../application/ports/identity-asset-references.port'
import {
  identityAssetPath,
  parseIdentityAssetKey,
} from '../../application/identity-assets'

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
