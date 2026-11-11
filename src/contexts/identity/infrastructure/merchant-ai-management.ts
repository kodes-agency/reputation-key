import type { Database } from '#/shared/db'
import { getMemberRole } from './repositories/manager-membership.repository'
import { decideMemberPropertyAuthority } from './repositories/member-property-authority'

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

/** Step-up proof is the caller's own password, and needs the request's headers. */
export const createStepUpVerifier =
  (
    verifyPassword: (
      input: Readonly<{ headers: Headers; password: string }>,
    ) => Promise<boolean>,
  ) =>
  async (input: Readonly<{ requestHeaders?: Headers; proof: string }>) =>
    input.requestHeaders !== undefined &&
    (await verifyPassword({ headers: input.requestHeaders, password: input.proof }))
