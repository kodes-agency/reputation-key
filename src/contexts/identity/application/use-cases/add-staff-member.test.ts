import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { addStaffMember, type StaffAccountDeps } from './add-staff-member'
import {
  STAFF_ONBOARDING_STEPS,
  type StaffOnboarding,
  type StaffOnboardingStep,
} from '../../domain/staff-account'
import type { StaffAccountStore } from '../ports/staff-account-store.port'

const input = {
  operationId: 'operation',
  propertyId: 'property',
  email: 'Polly@example.com',
  displayName: 'Polly Smith',
}
const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

function setup(fail?: StaffOnboardingStep, existingMember = false) {
  const operations = new Map<string, StaffOnboarding>()
  const people = new Set<string>()
  const portals = new Set<string>()
  const codes = new Set<string>()
  const invitations = new Set<string>()
  const linked = new Set<string>()
  let failurePending = fail !== undefined
  let queue = Promise.resolve()
  let counter = 0
  const after = (step: StaffOnboardingStep) => {
    if (failurePending && fail === step) {
      failurePending = false
      throw Object.assign(new Error('Injected failure after commit'), {
        code: 'injected_failure',
      })
    }
  }
  const store: StaffAccountStore = {
    withAddressLock: async (_org, _email, run) => {
      const previous = queue
      let release = () => {}
      queue = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        return await run(store)
      } finally {
        release()
      }
    },
    currentActor: async (ctx) => ctx,
    propertyIds: async () => null,
    addressFacts: async () => ({
      userId: existingMember ? 'account' : null,
      organizationIds: existingMember ? [ctx.organizationId] : [],
      alreadyStaffHere: linked.size > 0,
      alreadyInvited: false,
      staffParticipantId: null,
    }),
    findOperation: async (_org, id) => operations.get(id) ?? null,
    reserve: async (row) => {
      operations.set(row.id, row)
      return row
    },
    checkpoint: async (id, step, status, failureCode) => {
      const previous = operations.get(id)!
      const next = {
        ...previous,
        step,
        status,
        failureCode,
        ...(status === 'done' || status === 'cancelled'
          ? { email: null, displayName: null }
          : {}),
      }
      operations.set(id, next)
      return next
    },
    createPerson: async (row) => {
      people.add(row.staffParticipantId)
      after('person')
    },
    assignPortal: async () => {
      after('responsibility')
    },
    grantAccess: async (row, spend) => {
      if (!existingMember && !invitations.has(row.invitationId)) {
        await spend()
        invitations.add(row.invitationId)
      }
      linked.add(row.staffParticipationId)
      after('access')
      return { invited: !existingMember, userId: existingMember ? 'account' : null }
    },
  }
  const deps: StaffAccountDeps = {
    authorizeProperty: async () => undefined,
    store,
    spendAddressCheckBudget: async () => undefined,
    reportDeliveryFailure: () => undefined,
    idGen: () => `id-${++counter}`,
    invitationBudget: async () => 20,
    spendInvitationBudget: vi.fn(async () => undefined),
    deliverAccess: vi.fn(async () => undefined),
    portals: {
      archiveForMemberDeparture: async () => undefined,
      rename: async () => undefined,
      check: async () => ({ omittedLinks: [] }),
      create: async (row) => {
        portals.add(row.portalId)
        after('portal')
      },
      issueCode: async (id) => {
        codes.add(id)
        after('code')
      },
      publish: async () => {
        after('publication')
      },
      archive: async () => undefined,
    },
  }
  return { deps, operations, people, portals, codes, invitations, linked }
}

describe('addStaffMember', () => {
  it('refuses a competing invitation under the address lock before creating anything', async () => {
    const h = setup()
    const store = {
      ...h.deps.store,
      addressFacts: async () => ({
        userId: null,
        organizationIds: [],
        staffParticipantId: null,
        alreadyStaffHere: false,
        alreadyInvited: true,
      }),
    }
    const deps = {
      ...h.deps,
      store: {
        ...store,
        withAddressLock: async <T>(
          _org: string,
          _email: string,
          run: (store: StaffAccountStore) => Promise<T>,
        ) => run(store),
      },
    }
    await expect(addStaffMember(deps)(input, ctx)).rejects.toThrow(
      "This address already has an open invitation. Add them here once they've accepted.",
    )
    expect(h.people.size).toBe(0)
    expect(h.operations.size).toBe(0)
  })
  it('does not inspect an address after the actor check budget is exhausted', async () => {
    const h = setup()
    const facts = vi.fn(h.deps.store.addressFacts)
    await expect(
      addStaffMember({
        ...h.deps,
        store: { ...h.deps.store, addressFacts: facts },
        spendAddressCheckBudget: async () => {
          throw Object.assign(new Error('Wait'), { code: 'rate_limited' })
        },
      })(input, ctx),
    ).rejects.toMatchObject({ code: 'rate_limited' })
    expect(facts).not.toHaveBeenCalled()
  })
  it('reports a failed access email using the completed operation and keeps Add successful', async () => {
    const h = setup()
    const report = vi.fn()
    const result = await addStaffMember({
      ...h.deps,
      deliverAccess: async () => {
        throw new Error('Mail unavailable')
      },
      reportDeliveryFailure: report,
    })(input, ctx)
    expect(result.status).toBe('done')
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        id: input.operationId,
        invitationId: expect.any(String),
      }),
    )
  })
  it('reuses the linked person canonical name instead of renaming them from another Property', async () => {
    const h = setup(undefined, true)
    const facts = await h.deps.store.addressFacts(
      ctx.organizationId,
      input.propertyId,
      input.email,
    )
    const create = vi.fn(h.deps.portals.create)
    const store: StaffAccountStore = {
      ...h.deps.store,
      withAddressLock: async (_org, _email, run) => run(store),
      addressFacts: async () => ({
        ...facts,
        staffParticipantId: 'existing-person',
        staffDisplayName: 'Polly Smith',
      }),
    }
    await addStaffMember({
      ...h.deps,
      store,
      portals: { ...h.deps.portals, create },
    })({ ...input, displayName: 'A different typed name' }, ctx)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Polly Smith' }),
      expect.anything(),
    )
  })

  it.each(STAFF_ONBOARDING_STEPS)(
    'resumes a failure after %s without duplicate identifiers',
    async (step) => {
      const state = setup(step)
      const add = addStaffMember(state.deps)
      expect(await add(input, ctx)).toMatchObject({
        status: 'failed',
        step,
        code: 'injected_failure',
      })
      const reserved = state.operations.get(input.operationId)!
      const result = await add(input, ctx)
      expect(result).toMatchObject({
        status: 'done',
        participationId: reserved.staffParticipationId,
        portalId: reserved.portalId,
      })
      expect(state.people.size).toBe(1)
      expect(state.portals.size).toBe(1)
      expect(state.codes.size).toBe(1)
      expect(state.invitations.size).toBe(1)
      expect(state.deps.spendInvitationBudget).toHaveBeenCalledTimes(1)
      expect(state.operations.get(input.operationId)).toMatchObject({
        email: null,
        displayName: null,
      })
      expect(Object.keys(result).sort()).toEqual([
        'code',
        'operationId',
        'participationId',
        'portalId',
        'status',
        'step',
      ])
    },
  )

  it('serializes concurrent adds of the same address before creating anything', async () => {
    const state = setup()
    const add = addStaffMember(state.deps)
    const results = await Promise.allSettled([
      add(input, ctx),
      add({ ...input, operationId: 'another' }, ctx),
    ])
    expect(results.map((row) => row.status)).toEqual(['fulfilled', 'rejected'])
    expect(state.people.size).toBe(1)
    expect(state.portals.size).toBe(1)
  })

  it('links a current Organization member without an invitation or invitation spend', async () => {
    const state = setup(undefined, true)
    expect(await addStaffMember(state.deps)(input, ctx)).toMatchObject({ status: 'done' })
    expect(state.invitations.size).toBe(0)
    expect(state.linked.size).toBe(1)
    expect(state.deps.spendInvitationBudget).not.toHaveBeenCalled()
  })

  it('refuses another Organization before creating anything', async () => {
    const state = setup()
    const store = {
      ...state.deps.store,
      addressFacts: async () => ({
        userId: 'other',
        organizationIds: ['other-organization'],
        alreadyStaffHere: false,
        alreadyInvited: false,
        staffParticipantId: null,
      }),
    }
    const deps = {
      ...state.deps,
      store: {
        ...store,
        withAddressLock: async <T>(
          _org: string,
          _email: string,
          run: (value: StaffAccountStore) => Promise<T>,
        ) => run(store),
      },
    }
    await expect(addStaffMember(deps)(input, ctx)).rejects.toMatchObject({
      code: 'other_organization',
    })
    expect(state.people.size).toBe(0)
  })

  it('refuses a PropertyManager outside their Property scope', async () => {
    const state = setup()
    const deps = {
      ...state.deps,
      store: { ...state.deps.store, propertyIds: async () => [] },
    }
    await expect(
      addStaffMember(deps)(input, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(state.people.size).toBe(0)
  })

  it('does not provision a row when no invitations remain', async () => {
    const state = setup()
    await expect(
      addStaffMember({ ...state.deps, invitationBudget: async () => 0 })(input, ctx),
    ).rejects.toMatchObject({ code: 'rate_limited' })
    expect(state.people.size).toBe(0)
  })

  it('keeps a committed row done when delivery fails', async () => {
    const state = setup()
    expect(
      await addStaffMember({
        ...state.deps,
        deliverAccess: async () => {
          throw new Error('Email unavailable')
        },
      })(input, ctx),
    ).toMatchObject({ status: 'done' })
  })
})
