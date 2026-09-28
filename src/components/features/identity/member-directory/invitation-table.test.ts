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

  it('settles a refused cancellation instead of leaking the rejection', async () => {
    const cancels: InvitationInput[] = []
    renderTable({
      resendAction: refusingAction([]),
      cancelAction: refusingAction(cancels),
    })

    const unhandled = await unhandledRejectionsDuring(() =>
      recordedControl('Cancel invitation').onClick?.(),
    )

    expect(unhandled).toEqual([])
    expect(cancels).toEqual([{ data: { invitationId: 'invitation-1' } }])
  })
})
