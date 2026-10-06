// The table reports what was chosen (Change role, Edit access) from each row's
// menu and confirms a removal itself. Removing is confirmed in a dialog that stays
// open and says the refusal in place, so the table hands it the rejection.
//
// There is no DOM here: the table is server-rendered with its menu and remove
// dialog replaced by recorders, and the recorded callbacks are called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { MemberTable, type MemberRow } from './member-table'

type RecordedItem = Readonly<{ children?: ReactNode; onSelect?: () => unknown }>

const { menus, items, removeDialogs, permissions } = vi.hoisted(() => ({
  menus: [] as string[],
  items: [] as Array<
    Readonly<{ children?: ReactNode; onSelect?: () => unknown; menu: string }>
  >,
  removeDialogs: [] as Array<{ memberName: string; onRemove: () => Promise<unknown> }>,
  permissions: { granted: new Set<string>() },
}))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => permissions.granted.has(permission),
  }),
}))

vi.mock('#/components/ui/row-actions-menu', () => ({
  RowActionsMenu: ({
    name,
    children,
  }: Readonly<{ name: string; children?: ReactNode }>) => {
    menus.push(name)
    return children
  },
  RowActionsItem: (props: RecordedItem) => {
    items.push({ ...props, menu: menus.at(-1) ?? '' })
    return null
  },
  RowActionsSeparator: () => null,
}))

vi.mock('./remove-member-dialog', () => ({
  RemoveMemberDialog: (props: (typeof removeDialogs)[number]) => {
    removeDialogs.push(props)
    return null
  },
}))

const ADMIN: MemberRow = {
  id: 'member-admin',
  userId: 'user-admin',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'AccountAdmin',
  rawRole: 'owner',
}
const MANAGER: MemberRow = {
  id: 'member-maria',
  userId: 'user-maria',
  name: 'Maria Petrova',
  email: 'maria@example.com',
  role: 'PropertyManager',
  rawRole: 'admin',
  properties: [
    { id: 'p1', name: 'Meridian Sofia' },
    { id: 'p2', name: 'Varna Beach' },
    { id: 'p3', name: 'Harbour Cafe' },
  ],
}
const STRANDED: MemberRow = {
  ...MANAGER,
  id: 'member-nikolay',
  userId: 'user-nikolay',
  name: 'Nikolay Dimitrov',
  email: 'nikolay@example.com',
  properties: [],
}

type RemoveInput = { data: { memberId: string } }

/** A refused command, as a plain function so the rejection is not pre-handled. */
function refusingAction(calls: RemoveInput[]): Action<RemoveInput> {
  return Object.assign(
    async (input: RemoveInput) => {
      calls.push(input)
      throw new Error('The organization needs at least one Account Admin.')
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  )
}

function renderTable(
  overrides: Partial<Parameters<typeof MemberTable>[0]> & {
    members: ReadonlyArray<MemberRow>
  },
): string {
  return renderToStaticMarkup(
    createElement(MemberTable, {
      currentUserId: 'someone-else',
      showProperties: true,
      onChangeRole: () => undefined,
      onEditAccess: () => undefined,
      removeMemberAction: refusingAction([]),
      ...overrides,
    }),
  )
}

function item(label: string, menu?: string): RecordedItem {
  const found = items.find(
    (props) => props.children === label && (menu === undefined || props.menu === menu),
  )
  if (!found) throw new Error(`no "${label}" item was rendered`)
  return found
}

beforeEach(() => {
  menus.length = 0
  items.length = 0
  removeDialogs.length = 0
  permissions.granted = new Set(['member.list', 'member.update', 'member.delete'])
})

describe('MemberTable properties column', () => {
  it('says All properties for an Account Admin', () => {
    const html = renderTable({ members: [ADMIN] })
    expect(html).toContain('All properties')
    expect(html).toContain('and any added later')
  })

  it('names up to two properties for a manager and counts the rest', () => {
    const html = renderTable({ members: [MANAGER] })
    expect(html).toContain('Meridian Sofia, Varna Beach')
    expect(html).toContain('+1 more')
    expect(html).not.toContain('>Harbour Cafe<')
  })

  it('names the properties behind "+N more" in text a screen reader reaches, not only a tooltip', () => {
    const html = renderTable({ members: [MANAGER] })
    expect(html).toContain('<span class="sr-only">: Harbour Cafe</span>')
  })

  it('warns when a manager has no properties', () => {
    const html = renderTable({ members: [STRANDED] })
    expect(html).toContain('No properties')
    expect(html).toContain('Sees an empty app')
  })

  it('drops the column for a viewer who may not see Property access', () => {
    permissions.granted = new Set(['member.list'])
    const html = renderTable({
      members: [{ ...MANAGER, properties: undefined }],
      showProperties: false,
    })
    expect(html).not.toContain('Properties')
    expect(html).not.toContain('No properties')
  })
})

describe('MemberTable rows', () => {
  it('marks the signed-in person as (you)', () => {
    const html = renderTable({ members: [ADMIN, MANAGER], currentUserId: 'user-admin' })
    expect(html.match(/\(you\)/g)).toHaveLength(1)
    expect(html.indexOf('(you)')).toBeLessThan(html.indexOf('Maria Petrova'))
  })

  it('shows the full role label, not an abbreviation', () => {
    const html = renderTable({ members: [ADMIN, MANAGER] })
    expect(html).toContain('Account Admin')
    expect(html).toContain('Property Manager')
  })

  it('gives a member with no administrative permission no actions at all', () => {
    permissions.granted = new Set(['member.list'])
    const html = renderTable({ members: [ADMIN, MANAGER], showProperties: false })
    expect(html).not.toContain('Actions')
    expect(items).toEqual([])
    expect(removeDialogs).toEqual([])
  })

  it('gives the signed-in person no actions on their own row', () => {
    renderTable({ members: [MANAGER], currentUserId: MANAGER.userId })
    expect(items).toEqual([])
    expect(removeDialogs).toEqual([])
  })
})

describe('MemberTable commands', () => {
  it('names each row menu after the member', () => {
    renderTable({ members: [ADMIN, MANAGER] })
    expect(menus).toEqual(['Ada Lovelace', 'Maria Petrova'])
  })

  it('reports the member whose role is to be changed', () => {
    const onChangeRole = vi.fn()
    renderTable({ members: [ADMIN, MANAGER], onChangeRole })

    item('Change role', 'Maria Petrova').onSelect?.()

    expect(onChangeRole).toHaveBeenCalledExactlyOnceWith(MANAGER)
  })

  it('offers Edit access on a manager only, never on an Account Admin', () => {
    const onEditAccess = vi.fn()
    renderTable({ members: [ADMIN, MANAGER], onEditAccess })

    const edits = items.filter((props) => props.children === 'Edit access')
    expect(edits.map((props) => props.menu)).toEqual(['Maria Petrova'])
    edits[0]?.onSelect?.()
    expect(onEditAccess).toHaveBeenCalledExactlyOnceWith(MANAGER)
  })

  it('offers no Edit access when Property access is not visible', () => {
    renderTable({ members: [MANAGER], showProperties: false })
    expect(items.some((props) => props.children === 'Edit access')).toBe(false)
    expect(items.some((props) => props.children === 'Change role')).toBe(true)
  })

  it('hands a refused removal to the dialog, which shows it in place', async () => {
    const removals: RemoveInput[] = []
    renderTable({ members: [ADMIN], removeMemberAction: refusingAction(removals) })
    const [dialog] = removeDialogs
    if (!dialog) throw new Error('no remove dialog was rendered')

    await expect(dialog.onRemove()).rejects.toThrow(
      'The organization needs at least one Account Admin.',
    )
    expect(removals).toEqual([{ data: { memberId: 'member-admin' } }])
  })
})
