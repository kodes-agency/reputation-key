// Saving the Manage access sheet is a short sequence: the Property grants and
// revokes commit first (one command, one fact), then each changed
// responsibility goes through the Property's own Responsible managers command,
// which needs a current revision and the whole list. The access change is the
// one that matters, so a responsibility that cannot be saved is reported, not
// thrown over an access change that already committed.

import { describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  createSaveMemberAccess,
  responsibilityFailureReason,
} from './-member-access-save'

/** What a Property server function throws for a refusal the domain named. */
const refusal = (code: string, status: number) =>
  new ServerFunctionError('PropertyError', `refused: ${code}`, code, status)

const INPUT = {
  memberId: 'member-1',
  userId: 'user-1',
  grantPropertyIds: [] as string[],
  revokePropertyIds: [] as string[],
  responsibleOnPropertyIds: [] as string[],
  responsibleOffPropertyIds: [] as string[],
}

function deps(overrides: Partial<Parameters<typeof createSaveMemberAccess>[0]> = {}) {
  return {
    setAccess: vi.fn(
      async ({
        data,
      }: {
        data: { grantPropertyIds: string[]; revokePropertyIds: string[] }
      }) => ({
        grantedPropertyIds: data.grantPropertyIds,
        revokedPropertyIds: data.revokePropertyIds,
      }),
    ),
    listResponsible: vi.fn(async (_input: { data: { propertyId: string } }) => ({
      assignments: [{ userId: 'other-manager' }],
      revision: 4,
    })),
    updateResponsible: vi.fn(
      async (_input: {
        data: { propertyId: string; managerUserIds: string[]; expectedRevision: number }
      }) => ({}),
    ),
    ...overrides,
    reportFailure: vi.fn((_error: unknown) => undefined),
  }
}

describe('saveMemberAccess', () => {
  it('sends grants and revokes to one access command', async () => {
    const d = deps()
    const save = createSaveMemberAccess(d)

    const result = await save({
      ...INPUT,
      grantPropertyIds: ['a'],
      revokePropertyIds: ['b'],
    })

    expect(d.setAccess).toHaveBeenCalledExactlyOnceWith({
      data: { memberId: 'member-1', grantPropertyIds: ['a'], revokePropertyIds: ['b'] },
    })
    expect(result).toEqual({
      grantedPropertyIds: ['a'],
      revokedPropertyIds: ['b'],
      responsibilityFailures: [],
    })
    expect(d.listResponsible).not.toHaveBeenCalled()
  })

  it('skips the access command when only responsibility changed', async () => {
    const d = deps()
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(d.setAccess).not.toHaveBeenCalled()
    expect(result.grantedPropertyIds).toEqual([])
    expect(result.revokedPropertyIds).toEqual([])
  })

  it('makes the member responsible by adding them to the current list at the current revision', async () => {
    const d = deps()
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, grantPropertyIds: ['a'], responsibleOnPropertyIds: ['a'] })

    expect(d.updateResponsible).toHaveBeenCalledExactlyOnceWith({
      data: {
        propertyId: 'a',
        managerUserIds: ['other-manager', 'user-1'],
        expectedRevision: 4,
      },
    })
  })

  it('releases responsibility by removing only this member from the list', async () => {
    const d = deps({
      listResponsible: vi.fn(async () => ({
        assignments: [{ userId: 'user-1' }, { userId: 'other-manager' }],
        revision: 7,
      })),
    })
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, responsibleOffPropertyIds: ['a'] })

    expect(d.updateResponsible).toHaveBeenCalledExactlyOnceWith({
      data: { propertyId: 'a', managerUserIds: ['other-manager'], expectedRevision: 7 },
    })
  })

  it('commits the grants before it reads responsibility, which needs the grant', async () => {
    const order: string[] = []
    const d = deps({
      setAccess: vi.fn(async () => {
        order.push('access')
        return { grantedPropertyIds: ['a'], revokedPropertyIds: [] }
      }),
      listResponsible: vi.fn(async () => {
        order.push('read')
        return { assignments: [], revision: 1 }
      }),
    })
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, grantPropertyIds: ['a'], responsibleOnPropertyIds: ['a'] })

    expect(order).toEqual(['access', 'read'])
  })

  it('does not add a member who is already responsible a second time', async () => {
    const d = deps({
      listResponsible: vi.fn(async () => ({
        assignments: [{ userId: 'user-1' }],
        revision: 2,
      })),
    })
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(d.updateResponsible).toHaveBeenCalledExactlyOnceWith({
      data: { propertyId: 'a', managerUserIds: ['user-1'], expectedRevision: 2 },
    })
  })

  it('reports the properties whose responsibility could not be saved, with why, and saves the rest', async () => {
    const d = deps({
      updateResponsible: vi.fn(async ({ data }: { data: { propertyId: string } }) => {
        if (data.propertyId === 'a') throw refusal('responsible_manager_ineligible', 400)
        return {}
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({
      ...INPUT,
      grantPropertyIds: ['a', 'b'],
      responsibleOnPropertyIds: ['a', 'b'],
    })

    expect(result.responsibilityFailures).toEqual([
      { propertyId: 'a', code: 'responsible_manager_ineligible' },
    ])
    expect(result.grantedPropertyIds).toEqual(['a', 'b'])
    expect(d.updateResponsible).toHaveBeenCalledTimes(2)
  })

  it('reports a failed read of the current list the same way', async () => {
    const d = deps({
      listResponsible: vi.fn(async () => {
        throw refusal('property_not_found', 404)
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOffPropertyIds: ['a'] })

    expect(result.responsibilityFailures).toEqual([
      { propertyId: 'a', code: 'property_not_found' },
    ])
    expect(d.updateResponsible).not.toHaveBeenCalled()
  })

  it('names an error that carries no code as unknown, so a network failure still says something', async () => {
    const d = deps({
      listResponsible: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(result.responsibilityFailures).toEqual([{ propertyId: 'a', code: 'unknown' }])
  })

  it('hands every responsibility failure to monitoring, once, with the error itself', async () => {
    const conflict = refusal('responsible_manager_ineligible', 400)
    const network = new TypeError('Failed to fetch')
    const d = deps({
      updateResponsible: vi.fn(async ({ data }: { data: { propertyId: string } }) => {
        if (data.propertyId === 'a') throw conflict
        throw network
      }),
    })
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, responsibleOnPropertyIds: ['a', 'b'] })

    expect(d.reportFailure.mock.calls).toEqual([[conflict], [network]])
  })

  it('reads the list again and retries once when another admin changed it first', async () => {
    let attempts = 0
    const d = deps({
      listResponsible: vi.fn(async () => ({
        assignments: [{ userId: 'other-manager' }],
        revision: ++attempts === 1 ? 4 : 5,
      })),
      updateResponsible: vi.fn(
        async ({ data }: { data: { expectedRevision: number } }) => {
          if (data.expectedRevision === 4) throw refusal('revision_conflict', 409)
          return {}
        },
      ),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(result.responsibilityFailures).toEqual([])
    expect(d.listResponsible).toHaveBeenCalledTimes(2)
    expect(d.updateResponsible).toHaveBeenLastCalledWith({
      data: {
        propertyId: 'a',
        managerUserIds: ['other-manager', 'user-1'],
        expectedRevision: 5,
      },
    })
    expect(d.reportFailure).not.toHaveBeenCalled()
  })

  it('gives up after one retry and reports the conflict', async () => {
    const d = deps({
      updateResponsible: vi.fn(async () => {
        throw refusal('revision_conflict', 409)
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(result.responsibilityFailures).toEqual([
      { propertyId: 'a', code: 'revision_conflict' },
    ])
    expect(d.updateResponsible).toHaveBeenCalledTimes(2)
  })

  it('does not retry a refusal that a second attempt cannot change', async () => {
    const d = deps({
      updateResponsible: vi.fn(async () => {
        throw refusal('forbidden', 403)
      }),
    })
    const save = createSaveMemberAccess(d)

    await save({ ...INPUT, responsibleOnPropertyIds: ['a'] })

    expect(d.updateResponsible).toHaveBeenCalledTimes(1)
  })

  it('throws when the access command itself is refused, and touches nothing else', async () => {
    const d = deps({
      setAccess: vi.fn(async () => {
        throw new Error('forbidden')
      }),
    })
    const save = createSaveMemberAccess(d)

    await expect(
      save({ ...INPUT, grantPropertyIds: ['a'], responsibleOnPropertyIds: ['a'] }),
    ).rejects.toThrow('forbidden')
    expect(d.listResponsible).not.toHaveBeenCalled()
    expect(d.updateResponsible).not.toHaveBeenCalled()
  })
})

describe('responsibilityFailureReason', () => {
  it.each([
    ['revision_conflict', 'its Responsible managers changed while you were saving'],
    ['forbidden', 'you cannot change its Responsible managers'],
    ['responsible_manager_ineligible', 'they cannot be its Responsible manager'],
    ['property_not_found', 'it is no longer available'],
    ['property_not_active', 'it is no longer available'],
  ])('says why for %s', (code, reason) => {
    expect(responsibilityFailureReason(code)).toBe(reason)
  })

  it('falls back to a plain sentence for a code it does not know, and for no code', () => {
    expect(responsibilityFailureReason('something_new')).toBe('something went wrong')
    expect(responsibilityFailureReason('unknown')).toBe('something went wrong')
  })
})
