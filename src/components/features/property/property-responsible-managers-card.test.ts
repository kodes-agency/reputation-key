// Saving a Property's responsible managers calls the page's Action, which
// rejects on a refusal (a stale revision). The card's banner shows the refusal
// from the Action's own error; the Save click only has to settle the promise,
// or it escapes as an unhandled rejection.
//
// There is no DOM here: the card is server-rendered with its buttons replaced by
// recorders, and the recorded Save handler is called.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { unhandledRejectionsDuring } from '#/shared/testing/unhandled-rejections'
import { PropertyResponsibleManagersCard } from './property-responsible-managers-card'

type Recorded = Readonly<{ children?: ReactNode; onClick?: () => unknown }>
type UpdateInput = {
  data: { propertyId: string; managerUserIds: string[]; expectedRevision: number }
}

const { recorded } = vi.hoisted(() => ({ recorded: [] as Recorded[] }))

vi.mock('#/components/ui/button', () => ({
  Button: (props: Recorded) => {
    recorded.push(props)
    return null
  },
}))

beforeEach(() => {
  recorded.length = 0
})

describe('PropertyResponsibleManagersCard save', () => {
  it('settles a refused save instead of leaking the rejection', async () => {
    const saves: UpdateInput[] = []
    // A plain function, so the rejection is not pre-handled by a spy.
    const refusing: Action<UpdateInput> = Object.assign(
      async (input: UpdateInput) => {
        saves.push(input)
        throw new Error('Responsible managers changed. Reload and try again.')
      },
      { isPending: false, error: null, isSuccess: false, data: null },
    )
    renderToStaticMarkup(
      createElement(PropertyResponsibleManagersCard, {
        propertyId: 'property-1',
        state: {
          assignments: [{ userId: 'user-1' }],
          eligibleManagers: [{ userId: 'user-1' }],
          revision: 4,
          responsibilityNeeded: false,
        },
        members: [{ userId: 'user-1', name: 'Ada', email: 'ada@example.com' }],
        updateAction: refusing,
        disabled: false,
      }),
    )
    const save = recorded.find((props) => props.children === 'Save responsible managers')
    if (!save?.onClick) throw new Error('no Save control was rendered')

    const unhandled = await unhandledRejectionsDuring(() => save.onClick?.())

    expect(unhandled).toEqual([])
    expect(saves).toEqual([
      {
        data: {
          propertyId: 'property-1',
          managerUserIds: ['user-1'],
          expectedRevision: 4,
        },
      },
    ])
  })
})
