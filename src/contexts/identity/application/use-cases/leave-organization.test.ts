import { describe, expect, it, vi } from 'vitest'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type { MemberRecord } from '../ports/identity.port'
import type {
  MemberOffboardingPort,
  OutstandingResponsibility,
} from '../ports/member-offboarding.port'
import { OutstandingResponsibilitiesError, leaveOrganization } from './leave-organization'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const ORG = 'org-00000000-0000-0000-0000-000000000001'

const member = (
  overrides: Partial<MemberRecord> & Pick<MemberRecord, 'id' | 'userId' | 'rawRole'>,
): MemberRecord => ({
  email: `${overrides.userId}@test.com`,
  name: overrides.userId,
  role: overrides.rawRole === 'owner' ? 'AccountAdmin' : 'PropertyManager',
  image: null,
  createdAt: new Date('2026-01-01'),
  ...overrides,
})

const LEAVER = member({ id: 'member-leaver', userId: 'user-leaver', rawRole: 'admin' })
const OWNER = member({ id: 'member-owner', userId: 'user-owner', rawRole: 'owner' })
const SECOND_OWNER = member({
  id: 'member-owner-2',
  userId: 'user-owner-2',
  rawRole: 'owner',
})

const PORTAL: OutstandingResponsibility = {
  kind: 'portal_responsibility',
  resourceId: 'portal-1',
}
const PROPERTY: OutstandingResponsibility = {
  kind: 'property_responsibility',
  resourceId: 'property-1',
}
const INBOX: OutstandingResponsibility = {
  kind: 'inbox_assignment',
  resourceId: 'inbox-1',
}

function setup(
  input: Readonly<{
    members: readonly MemberRecord[]
    actor: MemberRecord
    outstanding?: readonly OutstandingResponsibility[]
    eligible?: boolean
    /** Responsibilities appearing on the SECOND read (a concurrent write). */
    afterTransfer?: readonly OutstandingResponsibility[]
  }>,
) {
  const identity = createInMemoryIdentityPort()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
  identity.seedMembers([...input.members])
  for (const seeded of input.members) {
    commandStore.seedMember({
      id: seeded.id,
      organizationId: ORG,
      userId: seeded.userId,
      email: seeded.email,
      role: seeded.rawRole,
      createdAt: seeded.createdAt,
    })
  }
  const outstanding = input.outstanding ?? []
  let reads = 0
  const transfer = vi.fn(async () => {})
  const offboarding: MemberOffboardingPort = {
    listOutstanding: async () => {
      reads += 1
      return reads === 1 ? outstanding : (input.afterTransfer ?? [])
    },
    isEligibleRecipient: async () => input.eligible ?? true,
    transfer,
  }
  const prepareGoogleConnectorDeparture = vi.fn(async () => {})
  const cancelGoogleImportsForUser = vi.fn(async () => {})
  const useCase = leaveOrganization({
    identity,
    commandStore,
    offboarding,
    clock: () => FIXED_TIME,
    prepareGoogleConnectorDeparture,
    cancelGoogleImportsForUser,
  })
  const ctx = buildTestAuthContext({
    userId: toUserId(input.actor.userId),
    organizationId: toOrganizationId(ORG),
    role: input.actor.rawRole === 'owner' ? 'AccountAdmin' : 'PropertyManager',
  })
  return {
    useCase,
    ctx,
    commandStore,
    outbox,
    transfer,
    prepareGoogleConnectorDeparture,
    cancelGoogleImportsForUser,
  }
}

describe('leaveOrganization', () => {
  it('refuses the sole AccountAdmin', async () => {
    const { useCase, ctx, commandStore } = setup({
      members: [OWNER, LEAVER],
      actor: OWNER,
    })

    await expect(useCase({ transfers: [] }, ctx)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'last_owner',
    })
    expect(commandStore.allMembers).toHaveLength(2)
  })

  it('lets an AccountAdmin leave once a second AccountAdmin exists', async () => {
    const { useCase, ctx, commandStore } = setup({
      members: [OWNER, SECOND_OWNER],
      actor: OWNER,
    })

    await expect(useCase({ transfers: [] }, ctx)).resolves.toMatchObject({
      success: true,
    })
    expect(commandStore.allMembers.map((m) => m.userId)).toEqual([SECOND_OWNER.userId])
  })

  it('refuses until every held responsibility is explicitly transferred', async () => {
    const { useCase, ctx, commandStore, transfer } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PORTAL, PROPERTY, INBOX],
    })

    const error = await useCase(
      { transfers: [{ ...PORTAL, toUserId: OWNER.userId }] },
      ctx,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OutstandingResponsibilitiesError)
    expect((error as OutstandingResponsibilitiesError).outstanding).toEqual([
      PROPERTY,
      INBOX,
    ])
    // Nothing partial: no transfer is applied when the set is incomplete.
    expect(transfer).not.toHaveBeenCalled()
    expect(commandStore.allMembers).toHaveLength(2)
  })

  it('transfers every responsibility to the named manager before leaving', async () => {
    const { useCase, ctx, commandStore, transfer } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PORTAL, PROPERTY, INBOX],
    })

    const result = await useCase(
      {
        transfers: [
          { ...PORTAL, toUserId: OWNER.userId },
          { ...PROPERTY, toUserId: OWNER.userId },
          { ...INBOX, toUserId: OWNER.userId },
        ],
      },
      ctx,
    )

    expect(result).toEqual({ success: true, transferred: 3 })
    expect(transfer).toHaveBeenCalledTimes(3)
    expect(commandStore.allMembers.map((m) => m.userId)).toEqual([OWNER.userId])
  })

  it('refuses a recipient who is not an eligible current manager', async () => {
    const { useCase, ctx, transfer } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PROPERTY],
      eligible: false,
    })

    await expect(
      useCase({ transfers: [{ ...PROPERTY, toUserId: OWNER.userId }] }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(transfer).not.toHaveBeenCalled()
  })

  it('refuses a self-transfer', async () => {
    const { useCase, ctx } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PROPERTY],
    })

    await expect(
      useCase({ transfers: [{ ...PROPERTY, toUserId: LEAVER.userId }] }, ctx),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('refuses a transfer of something the member does not hold', async () => {
    const { useCase, ctx } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PROPERTY],
    })

    await expect(
      useCase({ transfers: [{ ...PORTAL, toUserId: OWNER.userId }] }, ctx),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('blocks on a responsibility created while the transfers were applied', async () => {
    const { useCase, ctx, commandStore } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
      outstanding: [PROPERTY],
      afterTransfer: [INBOX],
    })

    const error = await useCase(
      { transfers: [{ ...PROPERTY, toUserId: OWNER.userId }] },
      ctx,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OutstandingResponsibilitiesError)
    expect((error as OutstandingResponsibilitiesError).outstanding).toEqual([INBOX])
    expect(commandStore.allMembers).toHaveLength(2)
  })

  /**
   * Session revocation, binding release and grant revocation are committed by
   * the atomic command store, not by this use case, so the contract asserted
   * here is that the leave reaches that ONE transaction with the correct
   * member and fact. `identity-command-store.test.ts` pins the four state
   * writes inside it.
   */
  it('delegates the offboarding writes to the single atomic transaction', async () => {
    const { useCase, ctx, commandStore, outbox } = setup({
      members: [OWNER, LEAVER],
      actor: LEAVER,
    })

    await useCase({ transfers: [] }, ctx)

    expect(commandStore.memberById(LEAVER.id)).toBeNull()
    expect(outbox.facts.map((event) => event._tag)).toEqual(['identity.member.removed'])
    expect(outbox.facts[0]).toMatchObject({
      userId: LEAVER.userId,
      removedBy: LEAVER.userId,
      occurredAt: FIXED_TIME,
    })
  })

  it('fences the provider authorities before the Identity commit', async () => {
    const {
      useCase,
      ctx,
      prepareGoogleConnectorDeparture,
      cancelGoogleImportsForUser,
      commandStore,
    } = setup({ members: [OWNER, LEAVER], actor: LEAVER })

    await useCase({ transfers: [] }, ctx)

    expect(prepareGoogleConnectorDeparture).toHaveBeenCalledWith(
      ORG,
      LEAVER.userId,
      'member_removed',
    )
    expect(cancelGoogleImportsForUser).toHaveBeenCalledWith(ORG, LEAVER.userId)
    expect(commandStore.allMembers).toHaveLength(1)
  })

  it('refuses a caller who is not a member of the Organization', async () => {
    const { useCase, ctx } = setup({
      members: [OWNER],
      actor: member({ id: 'ghost', userId: 'user-ghost', rawRole: 'admin' }),
    })

    await expect(useCase({ transfers: [] }, ctx)).rejects.toMatchObject({
      code: 'member_not_found',
    })
  })
})
