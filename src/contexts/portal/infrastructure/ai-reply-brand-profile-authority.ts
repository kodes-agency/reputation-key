import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyPortalBrandProfiles } from '#/shared/db/schema/portal.schema'
import { unbrand } from '#/shared/domain/ids'
import {
  aiReplyBrandProfile,
  digestAiReplyBrandDisplayName,
} from '#/shared/ai-reply-brand-profile.server'
import type { PortalAiReplyBrandProfilePublicApi } from '../application/public-api'

function parsedProfile(
  row:
    | Readonly<{
        displayName: string
        version: number
      }>
    | undefined,
) {
  if (!row) return null
  try {
    return aiReplyBrandProfile(row)
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

export const createPortalAiReplyBrandProfileAuthority = (
  db: Database,
): PortalAiReplyBrandProfilePublicApi => ({
  async readCurrentAiReplyBrandProfile(organizationId, propertyId) {
    const [row] = await db
      .select({
        displayName: propertyPortalBrandProfiles.displayName,
        version: propertyPortalBrandProfiles.version,
      })
      .from(propertyPortalBrandProfiles)
      .where(
        and(
          eq(propertyPortalBrandProfiles.organizationId, unbrand(organizationId)),
          eq(propertyPortalBrandProfiles.propertyId, unbrand(propertyId)),
        ),
      )
      .limit(1)
    return parsedProfile(row)
  },

  async isCurrentAiReplyBrandProfile(tx, input) {
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !/^[0-9a-f]{64}$/.test(input.displayNameDigest)
    ) {
      return false
    }
    const [row] = await tx
      .select({
        displayName: propertyPortalBrandProfiles.displayName,
        version: propertyPortalBrandProfiles.version,
      })
      .from(propertyPortalBrandProfiles)
      .where(
        and(
          eq(propertyPortalBrandProfiles.organizationId, unbrand(input.organizationId)),
          eq(propertyPortalBrandProfiles.propertyId, unbrand(input.propertyId)),
        ),
      )
      .limit(1)
      .for('share')
    if (!row || row.version !== input.version) return false
    try {
      return digestAiReplyBrandDisplayName(row.displayName) === input.displayNameDigest
    } catch (error) {
      if (error instanceof TypeError) return false
      throw error
    }
  },
})
