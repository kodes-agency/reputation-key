// Changing a member's role and removing a member call the route's Actions,
// which reject on a refusal (a stale membership, the last Account Admin). A role
// change is reported by the route's toast, so the table settles the promise or it
// escapes as an unhandled rejection. Removing is confirmed in a dialog that stays
// open and says the refusal itself, so the table hands it the rejection.
//
// There is no DOM here: the table is server-rendered with its role select and
// remove dialog replaced by recorders, and their recorded callbacks are called.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { MemberTable } from './member-table'

const { roleSelects, removeDialogs } = vi.hoisted(() => ({
  roleSelects: [] as Array<{ onRoleChange: (role: BetaInteractiveRole) => unknown }>,
  removeDialogs: [] as Array<{ onRemove: () => unknown }>,
}))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

vi.mock('./role-select', () => ({
  RoleSelect: (props: (typeof roleSelects)[number]) => {
    roleSelects.push(props)
    return null
  },
}))

vi.mock('./remove-member-dialog', () => ({
  RemoveMemberDialog: (props: (typeof removeDialogs)[number]) => {
    removeDialogs.push(props)
    return null
  },
}))

/** A refused command, as a plain function so the rejection is not pre-handled. */
function refusingAction<TInput>(calls: TInput[]): Action<TInput> {
  return Object.assign(
    async (input: TInput) => {
      calls.push(input)
      throw new Error('The organization needs at least one Account Admin.')
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  )
}

type RoleInput = { data: { memberId: string; role: BetaInteractiveRole } }
type RemoveInput = { data: { memberId: string } }

function renderTable(actions: {
  updateRoleAction: Action<RoleInput>
  removeMemberAction: Action<RemoveInput>
}) {
  renderToStaticMarkup(
    createElement(MemberTable, {
      members: [
        {
          id: 'member-1',
          userId: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'AccountAdmin',
          rawRole: 'owner',
        },
      ],
      currentUserId: 'manager-1',
      ...actions,
    }),
  )
}

beforeEach(() => {
  roleSelects.length = 0
  removeDialogs.length = 0
})

describe('MemberTable commands', () => {
  it('settles a refused role change instead of leaking the rejection', async () => {
    const changes: RoleInput[] = []
    renderTable({
      updateRoleAction: refusingAction(changes),
      removeMemberAction: refusingAction<RemoveInput>([]),
    })
    const [select] = roleSelects
    if (!select) throw new Error('no role select was rendered')

    const unhandled = await unhandledRejectionsDuring(() =>
      select.onRoleChange('PropertyManager'),
    )

    expect(unhandled).toEqual([])
    expect(changes).toEqual([{ data: { memberId: 'member-1', role: 'PropertyManager' } }])
  })

  it('hands a refused removal to the dialog, which shows it in place', async () => {
    const removals: RemoveInput[] = []
    renderTable({
      updateRoleAction: refusingAction<RoleInput>([]),
      removeMemberAction: refusingAction(removals),
    })
    const [dialog] = removeDialogs
    if (!dialog) throw new Error('no remove dialog was rendered')

    await expect(dialog.onRemove()).rejects.toThrow(
      'The organization needs at least one Account Admin.',
    )
    expect(removals).toEqual([{ data: { memberId: 'member-1' } }])
  })
})
