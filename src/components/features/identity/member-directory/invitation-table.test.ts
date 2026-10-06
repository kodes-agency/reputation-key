// The table's facts (sent, expires, inviter, properties) and its row menu. Resend
// and Cancel invitation (the items of an open invitation's menu) call the route's
// Actions, which reject on a refusal (the resend rate limit, an invitation already
// gone). Resend is reported by the route's toast, so the menu settles the promise
// or it escapes the click as an unhandled rejection. Cancelling is confirmed in a
// dialog that stays open and says the refusal in place, so the table hands it the
// rejection.
//
// There is no DOM here: the table is server-rendered with its menu and dialog
// primitives replaced by recorders, and the recorded handlers are called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { InvitationTable, type InvitationRow } from './invitation-table'

type Recorded = Readonly<{ children?: ReactNode; onSelect?: () => unknown }>

const { recorded, confirmations, permissions } = vi.hoisted(() => ({
  recorded: [] as Array<Readonly<{ children?: ReactNode; onSelect?: () => unknown }>>,
  confirmations: [] as Array<{ title: string; onConfirm: () => Promise<unknown> }>,
  permissions: { granted: new Set<string>() },
}))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => permissions.granted.has(permission),
  }),
}))

vi.mock('#/components/ui/row-actions-menu', () => ({
  RowActionsMenu: ({ children }: Readonly<{ children?: ReactNode }>) => children,
  RowActionsItem: (props: Recorded) => {
    recorded.push(props)
    return null
  },
  RowActionsSeparator: () => null,
}))

vi.mock('#/components/ui/confirmation-dialog', () => ({
  ConfirmationDialog: (props: (typeof confirmations)[number]) => {
    confirmations.push(props)
    return null
  },
}))

type InvitationInput = { data: { invitationId: string } }

/** A refused command, as a plain function so the rejection is not pre-handled. */
function refusingAction(calls: InvitationInput[]): Action<InvitationInput> {
  return Object.assign(
    async (input: InvitationInput) => {
      calls.push(input)
      throw new Error('Please wait before sending more invitations.')
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  )
}

const PENDING: InvitationRow = {
  id: 'invitation-1',
  email: 'pending@example.com',
  role: 'PropertyManager',
  rawRole: 'admin',
  status: 'pending',
  createdAt: new Date('2026-09-29T09:00:00Z'),
  expiresAt: new Date('2026-10-06T09:00:00Z'),
  inviterName: 'Ivana Georgieva',
  properties: [
    { id: 'p1', name: 'Meridian Sofia' },
    { id: 'p2', name: 'Varna Beach' },
    { id: 'p3', name: 'Harbour Cafe' },
  ],
}
const EXPIRED: InvitationRow = {
  ...PENDING,
  id: 'invitation-2',
  email: 'expired@example.com',
  status: 'expired',
  createdAt: new Date('2026-09-20T09:00:00Z'),
  expiresAt: new Date('2026-09-27T09:00:00Z'),
  inviterName: null,
  properties: [],
}
const ADMIN_INVITE: InvitationRow = {
  ...PENDING,
  id: 'invitation-3',
  email: 'admin@example.com',
  role: 'AccountAdmin',
  rawRole: 'owner',
  properties: [],
}

function renderTable(
  invitations: ReadonlyArray<InvitationRow>,
  actions: {
    resendAction?: Action<InvitationInput>
    cancelAction?: Action<InvitationInput>
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(InvitationTable, {
      invitations,
      resendAction: actions.resendAction ?? refusingAction([]),
      cancelAction: actions.cancelAction ?? refusingAction([]),
    }),
  )
}

function recordedItem(label: string, nth = 0): Recorded {
  const item = recorded.filter((props) => props.children === label)[nth]
  if (!item?.onSelect) throw new Error(`no "${label}" item was rendered`)
  return item
}

beforeEach(() => {
  recorded.length = 0
  confirmations.length = 0
  permissions.granted = new Set([
    'invitation.list',
    'invitation.cancel',
    'invitation.resend',
  ])
})

describe('InvitationTable facts', () => {
  it('shows when it was sent, when it expires, who sent it and which properties', () => {
    const html = renderTable([PENDING])

    expect(html).toContain('Sent')
    expect(html).toContain('29 Sep 2026')
    expect(html).toContain('6 Oct 2026')
    expect(html).toContain('Ivana Georgieva')
    expect(html).toContain('Meridian Sofia, Varna Beach')
    expect(html).toContain('+1 more')
    expect(html).not.toContain('Expired')
  })

  it('flags an expired invitation and names the day it lapsed', () => {
    const html = renderTable([EXPIRED])

    expect(html).toContain('Expired')
    expect(html).toContain('27 Sep 2026')
  })

  it('names the properties behind "+N more" in text a screen reader reaches, not only a tooltip', () => {
    expect(renderTable([PENDING])).toContain(
      '<span class="sr-only">: Harbour Cafe</span>',
    )
  })

  it('says All properties for an Account Admin invitation', () => {
    expect(renderTable([ADMIN_INVITE])).toContain('All properties')
  })

  it('warns when a manager invitation carries no properties', () => {
    expect(renderTable([EXPIRED])).toContain('None chosen')
  })

  it('does not print the raw status token', () => {
    const html = renderTable([PENDING])
    expect(html).not.toMatch(/>pending</)
  })

  it('is titled in sentence case', () => {
    expect(renderTable([PENDING])).toContain('>Invitations<')
  })

  it('says who is unknown when the inviter has left', () => {
    expect(renderTable([EXPIRED])).toContain('Unknown')
  })
})

describe('InvitationTable actions', () => {
  it('offers Resend and Cancel on a pending and on an expired invitation', () => {
    renderTable([PENDING, EXPIRED])

    expect(recorded.map((props) => props.children)).toEqual([
      'Resend invitation',
      'Cancel invitation',
      'Send a new link',
      'Cancel invitation',
    ])
    expect(confirmations.map((dialog) => dialog.title)).toEqual([
      'Cancel invitation to pending@example.com?',
      'Cancel invitation to expired@example.com?',
    ])
  })

  it('offers no actions without permission to cancel or resend', () => {
    permissions.granted = new Set(['invitation.list'])
    const html = renderTable([PENDING, EXPIRED])

    expect(html).not.toContain('Actions')
    expect(recorded).toEqual([])
    expect(confirmations).toEqual([])
  })

  it('settles a refused resend instead of leaking the rejection', async () => {
    const resends: InvitationInput[] = []
    renderTable([PENDING], { resendAction: refusingAction(resends) })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedItem('Resend invitation').onSelect?.(),
    )

    expect(unhandled).toEqual([])
    expect(resends).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })

  it('renews an expired invitation through the same resend command', async () => {
    const resends: InvitationInput[] = []
    renderTable([EXPIRED], { resendAction: refusingAction(resends) })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedItem('Send a new link').onSelect?.(),
    )

    expect(unhandled).toEqual([])
    expect(resends).toEqual([{ data: { invitationId: 'invitation-2' } }])
  })

  it('hands a refused cancellation to the dialog, which shows it in place', async () => {
    const cancels: InvitationInput[] = []
    renderTable([PENDING, EXPIRED], { cancelAction: refusingAction(cancels) })
    const [pending, expired] = confirmations
    if (!pending || !expired) throw new Error('no cancel confirmation was rendered')

    await expect(pending.onConfirm()).rejects.toThrow(
      'Please wait before sending more invitations.',
    )
    await expect(expired.onConfirm()).rejects.toThrow(
      'Please wait before sending more invitations.',
    )
    expect(cancels).toEqual([
      { data: { invitationId: 'invitation-1' } },
      { data: { invitationId: 'invitation-2' } },
    ])
  })
})
