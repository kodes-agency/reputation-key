import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  removeStaffMember,
  renameStaffMember,
  listStaffMembers,
  setColleagueListEnabled,
  checkStaffBatch,
  resendStaffInvitation,
  type ManageStaffDeps,
} from './manage-staff-accounts'
import type { StaffAccountStore } from '../ports/staff-account-store.port'
import type { StaffRemovalTarget } from '../ports/staff-management-store.port'

const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
function setup(
  options: Readonly<{
    fail?: 'deny' | 'login' | 'cancel' | 'archive'
    role?: string
    other?: boolean
  }> = {},
) {
  const calls: string[] = []
  let pending = !!options.fail
  let accessDenied = false
  let loginRemoved = false
  const row: StaffRemovalTarget = {
    participationId: 'participation',
    participantId: 'person',
    propertyId: 'property',
    portalId: 'portal',
    userId: 'user',
    memberId: 'member',
    memberRole: options.role ?? 'member',
    otherParticipations: options.other ?? false,
    active: true,
    removalComplete: false,
    email: 'polly@example.com',
  }
  const fail = (step: string) => {
    calls.push(step)
    if (pending && step === options.fail) {
      pending = false
      throw new Error('Injected failure')
    }
  }
  const store: StaffAccountStore = {
    withAddressLock: async (_email, run) => run(store),
    currentActor: async (ctx) => ctx,
    propertyIds: async () => null,
    addressFacts: async () => ({
      userId: null,
      organizationIds: [],
      alreadyStaffHere: false,
      staffParticipantId: null,
    }),
    findOperation: async () => null,
    reserve: async (row) => row,
    checkpoint: async () => {
      throw new Error('Not an onboarding')
    },
    createPerson: async () => undefined,
    assignPortal: async () => undefined,
    grantAccess: async () => ({ invited: true, userId: null }),
  }
  const deps: ManageStaffDeps = {
    authorizeProperty: async () => undefined,
    store,
    idGen: () => 'id',
    invitationBudget: async () => 12,
    spendInvitationBudget: async () => undefined,
    deliverAccess: async () => undefined,
    portals: {
      rename: async () => undefined,
      check: async () => ({ omittedLinks: [{ id: 'omitted', label: 'Old link' }] }),
      create: async () => undefined,
      issueCode: async () => undefined,
      publish: async () => undefined,
      archive: async () => {
        fail('archive')
      },
    },
    management: {
      completeRemoval: vi.fn(async () => undefined),
      cancelOnboardings: async () => {
        fail('cancel')
      },
      propertiesForParticipant: async () => ['property'],
      target: async () => ({
        ...row,
        ...(loginRemoved ? { memberId: null, userId: null } : {}),
      }),
      denyAccess: async () => {
        accessDenied = true
        fail('deny')
      },
      rename: vi.fn(async () => undefined),
      list: async () => [
        {
          participationId: 'participation',
          operationId: 'operation',
          displayName: 'Polly Smith',
          portalId: 'portal',
          email: 'polly@example.com',
          access: 'active',
          step: null,
          code: null,
        },
      ],
      setColleagues: vi.fn(async () => undefined),
      renewInvitation: async () => {
        throw new Error('Not a resend')
      },
    },
    removeLogin: async () => {
      loginRemoved = true
      fail('login')
    },
  }
  return {
    deps,
    calls,
    accessDenied: () => accessDenied,
    loginRemoved: () => loginRemoved,
  }
}

describe('staff removal convergence', () => {
  it('does nothing when an old completed removal is replayed after the user returns', async () => {
    const h = setup()
    const previous = (await h.deps.management.target(
      ctx.organizationId,
      'participation',
    ))!
    const deps = {
      ...h.deps,
      management: {
        ...h.deps.management,
        target: async () => ({
          ...previous,
          active: false,
          removalComplete: true,
          memberId: 'returning-membership',
        }),
      },
    }
    expect(
      await removeStaffMember(deps)({ participationId: 'participation' }, ctx),
    ).toEqual({
      removed: true,
    })
    expect(h.calls).toEqual([])
    expect(deps.management.completeRemoval).not.toHaveBeenCalled()
    expect(h.loginRemoved()).toBe(false)
  })
  it('rechecks completion after waiting for the address lock', async () => {
    const h = setup()
    const previous = (await h.deps.management.target(
      ctx.organizationId,
      'participation',
    ))!
    const read = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockResolvedValue({
        ...previous,
        active: false,
        removalComplete: true,
      })
    await removeStaffMember({
      ...h.deps,
      management: { ...h.deps.management, target: read },
    })({ participationId: 'participation' }, ctx)
    expect(h.calls).toEqual([])
    expect(h.deps.management.completeRemoval).not.toHaveBeenCalled()
  })
  it('uses the current user participation state inside the removal lock', async () => {
    const h = setup()
    const previous = (await h.deps.management.target(
      ctx.organizationId,
      'participation',
    ))!
    const read = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(previous)
      .mockResolvedValue({
        ...previous,
        otherParticipations: true,
      })
    await removeStaffMember({
      ...h.deps,
      management: { ...h.deps.management, target: read },
    })({ participationId: 'participation' }, ctx)
    expect(h.loginRemoved()).toBe(false)
    expect(h.calls).toEqual(['deny', 'cancel', 'archive'])
  })
  it('archives the Portal Add created while removal waited for the address lock', async () => {
    const h = setup()
    const initial = (await h.deps.management.target(ctx.organizationId, 'participation'))!
    let locked = false
    const archive = vi.fn(async () => undefined)
    const deps = {
      ...h.deps,
      store: {
        ...h.deps.store,
        withAddressLock: async <T>(
          _email: string,
          run: (store: StaffAccountStore) => Promise<T>,
        ) => {
          locked = true
          return run(h.deps.store)
        },
      },
      management: {
        ...h.deps.management,
        target: async () => ({ ...initial, portalId: locked ? 'newly-created' : null }),
      },
      portals: { ...h.deps.portals, archive },
    }
    await removeStaffMember(deps)({ participationId: 'participation' }, ctx)
    expect(archive).toHaveBeenCalledWith('newly-created', ctx)
  })
  it.each(['deny', 'login', 'cancel', 'archive'] as const)(
    'resumes a failure after %s with access already ended',
    async (fail) => {
      const state = setup({ fail })
      const remove = removeStaffMember(state.deps)
      await expect(remove({ participationId: 'participation' }, ctx)).rejects.toThrow(
        'Injected failure',
      )
      expect(state.accessDenied()).toBe(true)
      expect(await remove({ participationId: 'participation' }, ctx)).toEqual({
        removed: true,
      })
      expect(state.loginRemoved()).toBe(true)
      expect(state.calls[0]).toBe('deny')
      expect(state.calls.at(-1)).toBe('archive')
    },
  )
  it.each([{ role: 'owner' }, { role: 'admin' }, { role: 'member', other: true }])(
    'retains the login for %j',
    async (options) => {
      const state = setup(options)
      await removeStaffMember(state.deps)({ participationId: 'participation' }, ctx)
      expect(state.loginRemoved()).toBe(false)
      expect(state.calls).toEqual(['deny', 'cancel', 'archive'])
    },
  )
})

describe('staff manager reads and settings', () => {
  it('refuses Resend if removal ended the participation while it waited for the lock', async () => {
    const h = setup()
    const previous = (await h.deps.management.target(
      ctx.organizationId,
      'participation',
    ))!
    const spend = vi.fn(async () => undefined)
    const read = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockResolvedValue({ ...previous, active: false })
    const deps = {
      ...h.deps,
      spendInvitationBudget: spend,
      management: { ...h.deps.management, target: read },
    }
    await expect(
      resendStaffInvitation(deps)({ participationId: 'participation' }, ctx),
    ).rejects.toThrow('This staff participation has ended')
    expect(spend).not.toHaveBeenCalled()
  })
  it.each(['rename', 'resend'] as const)(
    'refuses %s on an ended participation before any writes',
    async (action) => {
      const h = setup()
      const previous = (await h.deps.management.target(
        ctx.organizationId,
        'participation',
      ))!
      const spend = vi.fn(async () => undefined)
      const deps = {
        ...h.deps,
        spendInvitationBudget: spend,
        management: {
          ...h.deps.management,
          target: async () => ({ ...previous, active: false }),
        },
      }
      const call =
        action === 'rename'
          ? renameStaffMember(deps)(
              { participationId: 'participation', displayName: 'New name' },
              ctx,
            )
          : resendStaffInvitation(deps)({ participationId: 'participation' }, ctx)
      await expect(call).rejects.toThrow('This staff participation has ended')
      expect(deps.management.rename).not.toHaveBeenCalled()
      expect(spend).not.toHaveBeenCalled()
      expect(h.calls).toEqual([])
    },
  )
  it('checks rows without reserving identifiers or spending invitation budget', async () => {
    const { deps } = setup()
    const result = await checkStaffBatch(deps)(
      {
        propertyId: 'property',
        rows: [
          { displayName: 'Polly', email: 'polly@example.com' },
          { displayName: 'Other', email: 'POLLY@example.com' },
          { displayName: '', email: 'another@example.com' },
          { displayName: 'Third', email: 'bad' },
        ],
      },
      ctx,
    )
    expect(result).toEqual({
      rows: [
        { code: 'duplicate_in_batch' },
        { code: 'duplicate_in_batch' },
        { code: 'name_required' },
        { code: 'invalid_email' },
      ],
      code: null,
      omittedLinks: [{ id: 'omitted', label: 'Old link' }],
      remainingInvitations: 12,
    })
  })
  it('omits email when the caller can read but cannot invite', async () => {
    const { deps } = setup()
    const reader = { ...ctx, effectivePermissions: new Set(['staff.read'] as const) }
    const result = await listStaffMembers(deps)({ propertyId: 'property' }, reader)
    expect(result.members[0]).not.toHaveProperty('email')
    expect(
      (await listStaffMembers(deps)({ propertyId: 'property' }, ctx)).members[0],
    ).toHaveProperty('email', 'polly@example.com')
  })
  it('allows only an AccountAdmin to change the colleague setting', async () => {
    const { deps } = setup()
    await expect(
      setColleagueListEnabled(deps)(
        { propertyId: 'property', enabled: true },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(
      await setColleagueListEnabled(deps)({ propertyId: 'property', enabled: true }, ctx),
    ).toEqual({ enabled: true })
  })
  it('trims a manager rename and writes through the one atomic name command', async () => {
    const { deps } = setup()
    expect(
      await renameStaffMember(deps)(
        { participationId: 'participation', displayName: '  Polly Jones ' },
        ctx,
      ),
    ).toEqual({ renamed: true })
    expect(deps.management.rename).toHaveBeenCalledWith(
      ctx.organizationId,
      expect.objectContaining({ participantId: 'person' }),
      'Polly Jones',
      expect.any(Function),
      ['property'],
    )
  })
})
