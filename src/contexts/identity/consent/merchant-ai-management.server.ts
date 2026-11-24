import type { Database } from '#/shared/db/index'
import { getMemberRole } from '../members/manager-membership-repository.server'
import { decideMemberPropertyAuthority } from '../members/member-property-authority.server'

/**
 * Whether the actor holds ai.manage over one Property. A non-member, a denial
 * and a failed authority read all refuse.
 */
export const createMerchantAiManagementAuthorizer =
  (db: Database) =>
  async (
    input: Readonly<{
      organizationId: string
      propertyId: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<boolean> => {
    const role = await getMemberRole(db, input.organizationId, input.actorUserId)
    if (!role) return false
    try {
      const decision = await decideMemberPropertyAuthority(db, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.actorUserId,
        memberRole: role,
        permission: 'ai.manage',
        at: input.now,
      })
      return decision.allowed
    } catch {
      return false
    }
  }
