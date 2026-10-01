// Identity context — what still points at an uploaded avatar or logo.
//
// Better Auth owns the `user` and `organization` rows; Identity reads them. An
// object is referenced while the row it is scoped to still holds its address.
// A logo also stops being referenced once its organization's closure becomes
// irreversible: the purge scrubs the organization's data, and what the public
// route would otherwise keep showing is that organization's logo.

import { and, eq, isNull, notInArray, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organization, user } from '#/shared/db/schema/auth'
import { organizationLifecycleAuthority } from '#/shared/db/schema/organization-lifecycle.schema'
import type { IdentityAssetReferencesPort } from '../../application/ports/identity-asset-references.port'
import {
  identityAssetPath,
  parseIdentityAssetKey,
} from '../../application/identity-assets'

/** Closure states after which an organization's logo is no longer shown. */
const LOGO_WITHDRAWN_STATES = ['purging', 'closed']

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

    // An organization with no lifecycle row has never been closed.
    const rows = await db
      .select({ id: organization.id })
      .from(organization)
      .leftJoin(
        organizationLifecycleAuthority,
        eq(organizationLifecycleAuthority.organizationId, organization.id),
      )
      .where(
        and(
          eq(organization.id, parsed.ownerId),
          eq(organization.logo, address),
          or(
            isNull(organizationLifecycleAuthority.state),
            notInArray(organizationLifecycleAuthority.state, LOGO_WITHDRAWN_STATES),
          ),
        ),
      )
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
