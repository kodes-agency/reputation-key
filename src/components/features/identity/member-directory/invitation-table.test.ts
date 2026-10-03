// Resend and Cancel invitation call the route's Actions, which reject on a
// refusal (the resend rate limit, an invitation already gone). Resend is reported
// by the route's toast, so the table settles the promise or it escapes the click
// as an unhandled rejection. Cancelling is confirmed in a dialog that stays open
// and says the refusal in place, so the table hands it the rejection.
//
// There is no DOM here: the table is server-rendered with its button and dialog
// primitives replaced by recorders, and the recorded handlers are called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { InvitationTable } from './invitation-table'

type Recorded = Readonly<{ children?: ReactNode; onClick?: () => unknown }>

const { recorded } = vi.hoisted(() => ({ recorded: [] as Recorded[] }))

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

vi.mock('#/components/ui/button', () => ({
  Button: (props: Recorded) => {
    recorded.push(props)
    return null
  },
}))

const { confirmations } = vi.hoisted(() => ({
  confirmations: [] as Array<{ onConfirm: () => Promise<unknown> }>,
}))

vi.mock('#/components/ui/confirmation-dialog', () => ({
  ConfirmationDialog: (props: (typeof confirmations)[number]) => {
    confirmations.push(props)
    return null
  },
  ConfirmationTrigger: () => null,
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

function renderTable(actions: {
  resendAction: Action<InvitationInput>
  cancelAction: Action<InvitationInput>
}) {
  renderToStaticMarkup(
    createElement(InvitationTable, {
      invitations: [
        {
          id: 'invitation-1',
          email: 'pending@example.com',
          role: 'PropertyManager',
          rawRole: 'admin',
          status: 'pending',
        },
      ],
      ...actions,
    }),
  )
}

function recordedControl(label: string): Recorded {
  const control = recorded.find((props) => props.children === label)
  if (!control?.onClick) throw new Error(`no "${label}" control was rendered`)
  return control
}

beforeEach(() => {
  recorded.length = 0
  confirmations.length = 0
})

describe('InvitationTable commands', () => {
  it('settles a refused resend instead of leaking the rejection', async () => {
    const resends: InvitationInput[] = []
    renderTable({
      resendAction: refusingAction(resends),
      cancelAction: refusingAction([]),
    })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedControl('Resend').onClick?.(),
    )

    expect(unhandled).toEqual([])
    expect(resends).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })

  it('hands a refused cancellation to the dialog, which shows it in place', async () => {
    const cancels: InvitationInput[] = []
    renderTable({
      resendAction: refusingAction([]),
      cancelAction: refusingAction(cancels),
    })
    const [dialog] = confirmations
    if (!dialog) throw new Error('no cancel confirmation was rendered')

    await expect(dialog.onConfirm()).rejects.toThrow(
      'Please wait before sending more invitations.',
    )
    expect(cancels).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })
})
