// What the pane shows while a reply confirmation is open over it, and what a
// dialog's host reports to the pane.
//
// The hold as a whole is React state and is exercised in a browser
// (`reply-command-refusal.stories.tsx`, and the real pane in
// `inbox-detail-content.stories.tsx`). Two parts of it have a way to go badly
// wrong that needs no browser to show:
//   - the pane is not remounted when the manager opens another item, so a hold
//     that was never released must not put the first item's reply on the second;
//   - a host outlives its dialog's last word. A confirmation still running when
//     its host is unmounted reports "closed" when it settles, and by then the
//     hold may belong to another dialog.

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ReplyConfirmationHold,
  detailOnScreen,
  useReplyConfirmationHold,
} from './use-reply-confirmation-hold'

const AS_READ = { reply: 'rejected by a colleague' }
const OPENED_ON = { reply: 'waiting for approval' }

describe('the detail a pane shows', () => {
  it('is the detail as read while no confirmation is open', () => {
    expect(detailOnScreen(null, 'item-1', AS_READ)).toBe(AS_READ)
  })

  it('is the detail the confirmation was opened on while it is open, whatever was read since', () => {
    const held = { itemId: 'item-1', detail: OPENED_ON }

    expect(detailOnScreen(held, 'item-1', AS_READ)).toBe(OPENED_ON)
  })

  it('is never a detail held for another item', () => {
    const heldForAnotherItem = { itemId: 'item-1', detail: OPENED_ON }

    expect(detailOnScreen(heldForAnotherItem, 'item-2', AS_READ)).toBe(AS_READ)
  })
})

/**
 * One dialog host under a pane that records what it is told. The unit project
 * has no DOM, so the host is rendered once on the server renderer and the
 * reporter it returned is called as its dialog would call it.
 */
function mountHost(): Readonly<{
  report: (isOpen: boolean) => void
  told: boolean[]
}> {
  const told: boolean[] = []
  const box: { report?: (isOpen: boolean) => void } = {}
  function Host() {
    box.report = useReplyConfirmationHold()
    return null
  }
  renderToString(
    createElement(
      ReplyConfirmationHold,
      { value: (isOpen: boolean) => told.push(isOpen) },
      createElement(Host),
    ),
  )
  if (!box.report) throw new Error('the host did not render')
  return { report: box.report, told }
}

describe("what a dialog's host tells the pane", () => {
  it('says once that its confirmation opened, and once that it closed', () => {
    const host = mountHost()

    host.report(true)
    host.report(false)

    expect(host.told).toEqual([true, false])
  })

  it('says nothing when a dialog that was not holding closes', () => {
    // The dialog of a host that was unmounted while its command ran: the
    // unmount released the hold, and the command settling closes the dialog
    // afterwards. By then the hold may be another dialog's, opened since.
    const host = mountHost()
    host.report(true)
    host.report(false)

    host.report(false)

    expect(host.told).toEqual([true, false])
  })
})
