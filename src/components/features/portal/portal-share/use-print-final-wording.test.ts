// What Share opens on, as the hook applies it when the read first arrives. The
// unit project has no DOM, so the hook is rendered once on the server renderer,
// which runs the render-phase update the hook makes; what the later renders and
// clicks do is the Storybook suite's (`portal-print-final-wording.stories.tsx`).

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFinalSavedWording } from '#/shared/domain/portal-print-final-wording'
import { usePrintFinalWording } from './use-print-final-wording'

const OWN = { en: { headline: 'Thanks for staying', subline: 'Tell us more' } }

const viewOf = (
  savedWording: PrintFinalSavedWording | null,
  lastWording: PrintFinalSavedWording | null,
): PortalPrintKitView =>
  ({
    savedWording,
    lastPrint:
      lastWording === null
        ? null
        : {
            printedAt: '2026-10-12T12:00:00.000Z',
            settings: {
              callToAction: lastWording.callToAction,
              customWords: lastWording.customWords,
            },
            photo: { kind: 'same' },
          },
  }) as unknown as PortalPrintKitView

/** Mounts the hook once and says what it opened the choice on, and how often. */
function opened(view: PortalPrintKitView | null) {
  const open = vi.fn()
  function Probe() {
    usePrintFinalWording({
      portalId: 'portal-1',
      view,
      print: null,
      saveMutation: undefined,
      open,
      onSaved: vi.fn(),
    })
    return null
  }
  renderToString(createElement(Probe))
  return open
}

describe('usePrintFinalWording opening wording', () => {
  const saved: PrintFinalSavedWording = { callToAction: 'how_was_stay', customWords: OWN }
  const last: PrintFinalSavedWording = { callToAction: 'rate_visit', customWords: null }

  it('opens on the saved wording, ahead of the last print’s', () => {
    const open = opened(viewOf(saved, last))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(saved)
  })

  it('opens on the last print’s wording when nothing was saved', () => {
    const open = opened(viewOf(null, last))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(last)
  })

  it('opens on the default wording when nothing was saved or printed', () => {
    const open = opened(viewOf(null, null))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith({
      callToAction: 'how_did_we_do',
      customWords: null,
    })
  })

  it('opens on nothing while the read has not arrived', () => {
    expect(opened(null)).not.toHaveBeenCalled()
  })
})
