import { checkStaffBatch, checkStaffSource } from './check-staff-batch.server'
import { changeStaffInvitationEmail } from './change-staff-email.server'
import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  removeStaffMember,
  removeStaffForMemberDeparture,
  renameStaffMember,
  listStaffMembers,
  setColleagueListEnabled,
  resendStaffInvitation,
  type ManageStaffDeps,
} from './manage-staff-accounts.server'
import type { StaffAccountStore } from './staff-account-store.port.server'
import type { StaffRemovalTarget } from './staff-management-store.port.server'

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
    hasLink: true,
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
    withAddressLocks: async (_emails, run) => run(store),
    markDeliveryProblem: vi.fn(async () => {}),
    withAddressLock: async (_email, run) => run(store),
    currentActor: async (ctx) => ctx,
    propertyIds: async () => null,
    addressFacts: async () => ({
      userId: null,
      organizationIds: [],
      alreadyStaffHere: false,
      alreadyInvited: false,
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
    spendAddressCheckBudget: async () => undefined,
    reportDeliveryFailure: () => undefined,
    idGen: () => 'id',
    invitationBudget: async () => 12,
    spendInvitationBudget: async () => undefined,
    deliverAccess: async () => undefined,
    portals: {
      archiveForMemberDeparture: async () => undefined,
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
      removalsForUser: async () => [],
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
      replaceInvitation: vi.fn(),
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
  it('retries a manager departure through the same removal steps without manager Property grants', async () => {
    const h = setup({ fail: 'archive', role: 'admin' })
    const departing = {
      ...ctx,
      effectivePermissions: new Set(['identity.leave_org'] as const),
    }
    const deps = {
      ...h.deps,
      management: {
        ...h.deps.management,
        removalsForUser: async () => ['participation'],
      },
      portals: { ...h.deps.portals, archiveForMemberDeparture: h.deps.portals.archive },
    }
    const remove = removeStaffForMemberDeparture(deps)
    await expect(remove('user', departing)).rejects.toThrow('Staff removal is unfinished')
    expect(h.accessDenied()).toBe(true)
    await remove('user', departing)
    expect(h.calls).toEqual(['deny', 'cancel', 'archive', 'deny', 'cancel', 'archive'])
    expect(h.loginRemoved()).toBe(false)
  })
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
        markDeliveryProblem: vi.fn(async () => {}),
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
  it('spends one address unit per batch row before reading any address facts', async () => {
    const h = setup()
    const facts = vi.fn(h.deps.store.addressFacts)
    const spend = vi.fn(async () => {
      throw Object.assign(new Error('Budget used'), { code: 'rate_limited' })
    })
    const deps = {
      ...h.deps,
      spendAddressCheckBudget: spend,
      store: { ...h.deps.store, addressFacts: facts },
    }
    await expect(
      checkStaffBatch(deps)(
        {
          propertyId: 'property',
          rows: [
            { email: 'one@example.com', displayName: 'One' },
            { email: 'two@example.com', displayName: 'Two' },
          ],
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'rate_limited' })
    expect(spend).toHaveBeenCalledWith(ctx, 2)
    expect(facts).not.toHaveBeenCalled()
  })
  it('reports an open invitation as already_invited without spending invitation budget', async () => {
    const h = setup()
    const spend = vi.fn(h.deps.spendInvitationBudget)
    const deps = {
      ...h.deps,
      spendInvitationBudget: spend,
      store: {
        ...h.deps.store,
        addressFacts: async () => ({
          userId: null,
          organizationIds: [],
          staffParticipantId: null,
          alreadyStaffHere: false,
          alreadyInvited: true,
        }),
      },
    }
    expect(
      (
        await checkStaffBatch(deps)(
          {
            propertyId: 'property',
            rows: [{ email: 'one@example.com', displayName: 'One' }],
          },
          ctx,
        )
      ).rows,
    ).toEqual([{ code: 'already_invited' }])
    expect(spend).not.toHaveBeenCalled()
  })
  it('does not spend a resend invitation when renewal checks refuse', async () => {
    const h = setup()
    const spend = vi.fn(h.deps.spendInvitationBudget)
    await expect(
      resendStaffInvitation({ ...h.deps, spendInvitationBudget: spend })(
        { participationId: 'participation' },
        ctx,
      ),
    ).rejects.toThrow('Not a resend')
    expect(spend).not.toHaveBeenCalled()
  })
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
      invitationsRequired: 0,
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

it('returns the Group target lock as a batch problem before any person is created', async () => {
  const { deps } = setup()
  const result = await checkStaffBatch({
    ...deps,
    portals: {
      ...deps.portals,
      check: async () => {
        throw Object.assign(new Error('End the goal first.'), {
          code: 'personal_portal_goal_locked',
        })
      },
    },
  })(
    {
      propertyId: 'property',
      portalGroupId: 'group',
      rows: [{ email: 'polly@example.com', displayName: 'Polly' }],
    },
    ctx,
  )
  expect(result.code).toBe('personal_portal_goal_locked')
})
it.each(['PropertyManager', 'AccountAdmin'] as const)(
  'limits address detail for %s on batch checks',
  async (role) => {
    const { deps } = setup()
    const reportAddressRefusal = vi.fn()
    const store = {
      ...deps.store,
      addressFacts: async () => ({
        userId: 'elsewhere',
        organizationIds: ['elsewhere'],
        alreadyStaffHere: false,
        alreadyInvited: false,
        staffParticipantId: null,
      }),
    }
    const actor = buildTestAuthContext({ role })
    const result = await checkStaffBatch({ ...deps, store, reportAddressRefusal })(
      {
        propertyId: 'property',
        rows: [{ email: 'polly@example.com', displayName: 'Polly' }],
      },
      actor,
    )
    expect(result.rows).toEqual([
      { code: role === 'AccountAdmin' ? 'other_organization' : 'cannot_add' },
    ])
    expect(reportAddressRefusal).toHaveBeenCalledTimes(role === 'AccountAdmin' ? 0 : 1)
  },
)

it.each(['AccountAdmin', 'PropertyManager'] as const)(
  'limits address detail for %s on Resend',
  async (role) => {
    const { deps } = setup()
    const reportAddressRefusal = vi.fn()
    const store: StaffAccountStore = {
      ...deps.store,
      addressFacts: async () => ({
        userId: 'elsewhere',
        organizationIds: ['elsewhere'],
        alreadyStaffHere: false,
        alreadyInvited: false,
        staffParticipantId: null,
      }),
    }
    await expect(
      resendStaffInvitation({
        ...deps,
        reportAddressRefusal,
        store: {
          ...store,
          markDeliveryProblem: vi.fn(async () => {}),
          withAddressLock: async <T>(
            _email: string,
            run: (value: StaffAccountStore) => Promise<T>,
          ) => run(store),
        },
      })({ participationId: 'participation' }, buildTestAuthContext({ role })),
    ).rejects.toMatchObject({
      code: role === 'AccountAdmin' ? 'other_organization' : 'cannot_add',
    })
    expect(reportAddressRefusal).toHaveBeenCalledTimes(role === 'AccountAdmin' ? 0 : 1)
  },
)

describe('correcting a staff invitation email', () => {
  async function pendingSetup() {
    const h = setup()
    const current = (await h.deps.management.target(ctx.organizationId, 'participation'))!
    const replaceInvitation = vi.fn(
      async () =>
        ({ email: 'fixed@example.com', staffParticipationId: 'participation' }) as never,
    )
    return {
      ...h,
      deps: {
        ...h.deps,
        management: {
          ...h.deps.management,
          target: async () => ({ ...current, userId: null, hasLink: false }),
          replaceInvitation,
        },
      },
      replaceInvitation,
    }
  }
  it('keeps the person and code and locks both addresses in stable order', async () => {
    const h = await pendingSetup()
    const locked: string[] = []
    const store: StaffAccountStore = {
      ...h.deps.store,
      withAddressLocks: async <T>(
        emails: readonly string[],
        run: (store: StaffAccountStore) => Promise<T>,
      ) => {
        locked.push(...emails)
        return run(store)
      },
    }
    const deliverAccess = vi.fn(async () => undefined)
    await changeStaffInvitationEmail({ ...h.deps, store, deliverAccess })(
      { participationId: 'participation', email: ' Fixed@example.com ' },
      ctx,
    )
    expect(locked).toEqual(['fixed@example.com', 'polly@example.com'])
    expect(h.replaceInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        participationId: 'participation',
        email: 'fixed@example.com',
        oldEmail: 'polly@example.com',
      }),
      expect.any(Function),
    )
    expect(deliverAccess).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fixed@example.com' }),
      { invited: true, userId: null },
    )
  })
  it('refuses linked people before taking an address lock', async () => {
    const h = setup()
    await expect(
      changeStaffInvitationEmail(h.deps)(
        { participationId: 'participation', email: 'fixed@example.com' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'operation_conflict' })
  })
  it('hides another Organization from a Property Manager', async () => {
    const h = await pendingSetup()
    const store: StaffAccountStore = {
      ...h.deps.store,
      withAddressLocks: async (_emails, run) => run(store),
      withAddressLock: async (_email, run) => run(store),
      addressFacts: async () => ({
        userId: 'elsewhere',
        organizationIds: ['other'],
        alreadyStaffHere: false,
        alreadyInvited: false,
        staffParticipantId: null,
      }),
    }
    const deps = { ...h.deps, store }
    await expect(
      changeStaffInvitationEmail(deps)(
        { participationId: 'participation', email: 'fixed@example.com' },
        { ...ctx, role: 'PropertyManager' },
      ),
    ).rejects.toMatchObject({ code: 'cannot_add', message: "This email can't be added." })
    expect(h.replaceInvitation).not.toHaveBeenCalled()
  })
  it('rechecks manager authority after waiting for both address locks', async () => {
    const h = await pendingSetup()
    const store: StaffAccountStore = {
      ...h.deps.store,
      withAddressLocks: async (_emails, run) => run(store),
      currentActor: async () => null,
    }
    await expect(
      changeStaffInvitationEmail({ ...h.deps, store })(
        { participationId: 'participation', email: 'fixed@example.com' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(h.replaceInvitation).not.toHaveBeenCalled()
  })
  it('does not send an invitation that an existing Organization member cannot accept', async () => {
    const h = await pendingSetup()
    const store: StaffAccountStore = {
      ...h.deps.store,
      withAddressLocks: async (_emails, run) => run(store),
      addressFacts: async () => ({
        userId: 'existing',
        organizationIds: [ctx.organizationId],
        alreadyStaffHere: false,
        alreadyInvited: false,
        staffParticipantId: null,
      }),
    }
    await expect(
      changeStaffInvitationEmail({ ...h.deps, store })(
        { participationId: 'participation', email: 'fixed@example.com' },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'cannot_add',
      message: 'This email already has an account here. Use another email address.',
    })
    expect(h.replaceInvitation).not.toHaveBeenCalled()
  })
  it('records a failed send for Resend without reverting the email', async () => {
    const h = await pendingSetup()
    await expect(
      changeStaffInvitationEmail({
        ...h.deps,
        deliverAccess: async () => {
          throw new Error('Mail failed')
        },
      })({ participationId: 'participation', email: 'fixed@example.com' }, ctx),
    ).rejects.toMatchObject({ message: expect.stringContaining('Use Resend') })
    expect(h.deps.store.markDeliveryProblem).toHaveBeenCalledWith(
      ctx.organizationId,
      'participation',
      true,
    )
  })
})

it('previews omitted links with the same source gate, before entering a person', async () => {
  const h = setup()
  expect(
    await checkStaffSource(h.deps)(
      { propertyId: 'property', sourcePortalId: 'source' },
      ctx,
    ),
  ).toEqual({ omittedLinks: [{ id: 'omitted', label: 'Old link' }] })
})
