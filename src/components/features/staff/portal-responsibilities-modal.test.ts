// Saving Portal responsibilities calls the page's Action, which rejects on a
// refusal (a stale revision). The dialog's banner shows the refusal from the
// Action's own error and the dialog stays open; the Save click only has to
// settle the promise, or it escapes as an unhandled rejection.
//
// There is no DOM here: the dialog is server-rendered with its portal-mounted
// frame passed through and its buttons replaced by recorders, and the recorded
// Save handler is called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type { UpdatePortalResponsibilitiesMutationInput } from '#/components/features/staff/types'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { PortalResponsibilitiesModal } from './portal-responsibilities-modal'

type Recorded = Readonly<{ children?: ReactNode; onClick?: () => unknown }>
type UpdateInput = { data: UpdatePortalResponsibilitiesMutationInput }

const { recorded } = vi.hoisted(() => ({ recorded: [] as Recorded[] }))

vi.mock('#/components/ui/button', () => ({
  Button: (props: Recorded) => {
    recorded.push(props)
    return null
  },
}))

vi.mock('#/components/ui/dialog', async () => {
  const { createElement: h, Fragment } = await import('react')
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    h(Fragment, null, children)
  return {
    Dialog: Passthrough,
    DialogCancel: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
  }
})

beforeEach(() => {
  recorded.length = 0
})

describe('PortalResponsibilitiesModal save', () => {
  it('settles a refused save and stays open instead of leaking the rejection', async () => {
    const saves: UpdateInput[] = []
    const openChanges: boolean[] = []
    // A plain function, so the rejection is not pre-handled by a spy.
    const refusing: Action<UpdateInput> = Object.assign(
      async (input: UpdateInput) => {
        saves.push(input)
        throw new Error('This participation changed. Reload and try again.')
      },
      { isPending: false, error: null, isSuccess: false, data: null },
    )
    renderToStaticMarkup(
      createElement(PortalResponsibilitiesModal, {
        staffParticipationId: 'sp-1',
        displayName: 'Avery Morgan',
        currentPrimaryPortalId: 'portal-1',
        currentSupportingPortalIds: [],
        expectedRevision: 3,
        allPortals: [{ id: 'portal-1', name: 'Main entrance' }],
        updateAction: refusing,
        onOpenChange: (open) => {
          openChanges.push(open)
        },
      }),
    )
    const save = recorded.find((props) => props.children === 'Save responsibilities')
    if (!save?.onClick) throw new Error('no Save control was rendered')

    const unhandled = await unhandledRejectionsDuring(() => save.onClick?.())

    expect(unhandled).toEqual([])
    expect(saves).toEqual([
      {
        data: {
          staffParticipationId: 'sp-1',
          primaryPortalId: 'portal-1',
          supportingPortalIds: [],
          expectedRevision: 3,
        },
      },
    ])
    expect(openChanges).toEqual([])
  })
})
