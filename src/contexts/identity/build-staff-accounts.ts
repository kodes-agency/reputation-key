import {
  spendInvitationSendBudget,
  readInvitationSendBudget,
} from '#/shared/auth/invitation-send-budget'
import { staffAccountError } from './domain/staff-account'
import type { Database } from '#/shared/db'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ManageStaffDeps } from './application/use-cases/manage-staff-accounts'
import {
  checkStaffBatch,
  removeStaffMember,
  renameStaffMember,
  listStaffMembers,
  setColleagueListEnabled,
  resendStaffInvitation,
} from './application/use-cases/manage-staff-accounts'
import { addStaffMember } from './application/use-cases/add-staff-member'
import { createStaffAccountStore } from './infrastructure/staff-account-store'
import { createStaffManagementStore } from './infrastructure/adapters/staff-management.store'
import type { IdentityCommandStore } from './application/ports/identity-command-store.port'
import { identityMemberRemoved } from './domain/events'
import { userId } from '#/shared/domain/ids'

export type StaffAccountBindings = Pick<
  ManageStaffDeps,
  | 'authorizeProperty'
  | 'portals'
  | 'spendInvitationBudget'
  | 'invitationBudget'
  | 'deliverAccess'
>
const unavailable = async (): Promise<never> => {
  throw new Error('Staff account bindings are unavailable')
}

export function buildStaffAccounts(
  deps: Readonly<{
    db: Database
    clock: () => Date
    idGen: () => string
    commandStore: IdentityCommandStore
    staffAccounts?: StaffAccountBindings
  }>,
) {
  const store = createStaffAccountStore(deps.db, deps.clock, {
    connect: () => deps.db.$client.connect(),
  })
  const management = createStaffManagementStore(deps.db, deps.clock)
  const input: ManageStaffDeps = {
    store,
    management,
    idGen: deps.idGen,
    ...(deps.staffAccounts ?? {
      authorizeProperty: unavailable,
      portals: {
        rename: unavailable,
        check: unavailable,
        create: unavailable,
        issueCode: unavailable,
        publish: unavailable,
        archive: unavailable,
      },
      spendInvitationBudget: unavailable,
      invitationBudget: unavailable,
      deliverAccess: unavailable,
    }),
    removeLogin: async (memberId, targetUserId, ctx) => {
      try {
        await deps.commandStore.removeMember({
          organizationId: ctx.organizationId,
          memberId,
          staffOnly: true,
          event: identityMemberRemoved({
            organizationId: ctx.organizationId,
            userId: userId(targetUserId),
            removedBy: ctx.userId,
            occurredAt: deps.clock(),
          }),
        })
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'member_not_found'
        )
          throw error
      }
    },
  }
  return Object.freeze({
    checkStaffBatch: checkStaffBatch(input),
    addStaffMember: addStaffMember(input),
    removeStaffMember: removeStaffMember(input),
    renameStaffMember: renameStaffMember(input),
    listStaffMembers: listStaffMembers(input),
    setColleagueListEnabled: setColleagueListEnabled(input),
    resendStaffInvitation: resendStaffInvitation(input),
    propertyForParticipation: async (participationId: string, ctx: AuthContext) =>
      (await management.target(ctx.organizationId, participationId))?.propertyId ?? null,
  })
}

export function createStaffInvitationBudget(
  rateLimiter: Parameters<typeof spendInvitationSendBudget>[0]['rateLimiter'],
  keyHmacSecret: string,
) {
  const input = (ctx: AuthContext) => ({
    rateLimiter,
    keyHmacSecret,
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
  })
  return {
    spend: async (ctx: AuthContext) => {
      if (!(await spendInvitationSendBudget(input(ctx))))
        throw staffAccountError(
          'rate_limited',
          'Please wait before sending more invitations',
        )
    },
    remaining: (ctx: AuthContext) => readInvitationSendBudget(input(ctx)),
  }
}
