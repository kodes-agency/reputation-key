// Resend and Cancel invitation call the route's Actions, which reject on a
// refusal (the resend rate limit, an invitation already gone). The route reports
// the refusal through useActionMutation's errorMessage; the table only has to
// settle the promise, or it escapes the click as an unhandled rejection.
//
// There is no DOM here: the table is server-rendered with its button and dialog
// primitives replaced by recorders, and the recorded click handlers are called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { InvitationTable, type InvitationRow } from './invitation-table'

type Recorded = Readonly<{ children?: ReactNode; onClick?: () => unknown }>

const { recorded, permissions } = vi.hoisted(() => ({
  recorded: [] as Array<{ children?: ReactNode; onClick?: () => unknown }>,
  permissions: { granted: new Set<string>() },
}))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => permissions.granted.has(permission),
  }),
}))

vi.mock('#/components/ui/button', () => ({
  Button: (props: Recorded) => {
    recorded.push(props)
    return null
  },
}))

vi.mock('#/components/ui/alert-dialog', async () => {
  const { createElement: h, Fragment: F } = await import('react')
  const Passthrough = ({ children }: { children?: ReactNode }) => h(F, null, children)
  return {
    AlertDialog: Passthrough,
    AlertDialogCancel: Passthrough,
    AlertDialogContent: Passthrough,
    AlertDialogDescription: Passthrough,
    AlertDialogFooter: Passthrough,
    AlertDialogHeader: Passthrough,
    AlertDialogTitle: Passthrough,
    AlertDialogTrigger: Passthrough,
    AlertDialogAction: (props: Recorded) => {
      recorded.push(props)
      return null
    },
  }
})

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

function recordedControl(label: string, nth = 0): Recorded {
  const matches = recorded.filter((props) => props.children === label)
  const control = matches[nth]
  if (!control?.onClick) throw new Error(`no "${label}" control was rendered`)
  return control
}

beforeEach(() => {
  recorded.length = 0
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

    const labels = recorded.map((props) => props.children)
    expect(labels.filter((label) => label === 'Resend')).toHaveLength(1)
    expect(labels.filter((label) => label === 'New link')).toHaveLength(1)
    expect(labels.filter((label) => label === 'Cancel')).toHaveLength(2)
  })

  it('offers no actions without permission to cancel or resend', () => {
    permissions.granted = new Set(['invitation.list'])
    const html = renderTable([PENDING, EXPIRED])

    expect(html).not.toContain('Actions')
    expect(recorded).toEqual([])
  })

  it('settles a refused resend instead of leaking the rejection', async () => {
    const resends: InvitationInput[] = []
    renderTable([PENDING], { resendAction: refusingAction(resends) })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedControl('Resend').onClick?.(),
    )

    expect(unhandled).toEqual([])
    expect(resends).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })

  it('renews an expired invitation through the same resend command', async () => {
    const resends: InvitationInput[] = []
    renderTable([EXPIRED], { resendAction: refusingAction(resends) })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedControl('New link').onClick?.(),
    )

    expect(unhandled).toEqual([])
    expect(resends).toEqual([{ data: { invitationId: 'invitation-2' } }])
  })

  it('settles a refused cancellation instead of leaking the rejection', async () => {
    const cancels: InvitationInput[] = []
    renderTable([PENDING], { cancelAction: refusingAction(cancels) })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedControl('Cancel invitation').onClick?.(),
    )

    expect(unhandled).toEqual([])
    expect(cancels).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })

  it('cancels an expired invitation as well', async () => {
    const cancels: InvitationInput[] = []
    renderTable([EXPIRED], { cancelAction: refusingAction(cancels) })

    await unhandledRejectionsDuring(() =>
      recordedControl('Cancel invitation').onClick?.(),
    )

    expect(cancels).toEqual([{ data: { invitationId: 'invitation-2' } }])
  })
})
