// Saving the Manage access sheet is a short sequence: the Property grants and
// revokes commit first (one command, one fact), then each changed
// responsibility goes through the Property's own Responsible managers command,
// which needs a current revision and the whole list. The access change is the
// one that matters, so a responsibility that cannot be saved is reported, not
// thrown over an access change that already committed.

import { describe, expect, it, vi } from 'vitest'
import { createSaveMemberAccess } from './-member-access-save'

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
      responsibilityFailedPropertyIds: [],
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

  it('reports the properties whose responsibility could not be saved, and saves the rest', async () => {
    const d = deps({
      updateResponsible: vi.fn(async ({ data }: { data: { propertyId: string } }) => {
        if (data.propertyId === 'a') throw new Error('revision conflict')
        return {}
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({
      ...INPUT,
      grantPropertyIds: ['a', 'b'],
      responsibleOnPropertyIds: ['a', 'b'],
    })

    expect(result.responsibilityFailedPropertyIds).toEqual(['a'])
    expect(result.grantedPropertyIds).toEqual(['a', 'b'])
    expect(d.updateResponsible).toHaveBeenCalledTimes(2)
  })

  it('reports a failed read of the current list the same way', async () => {
    const d = deps({
      listResponsible: vi.fn(async () => {
        throw new Error('not found')
      }),
    })
    const save = createSaveMemberAccess(d)

    const result = await save({ ...INPUT, responsibleOffPropertyIds: ['a'] })

    expect(result.responsibilityFailedPropertyIds).toEqual(['a'])
    expect(d.updateResponsible).not.toHaveBeenCalled()
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
