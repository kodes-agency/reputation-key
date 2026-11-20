import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { PRINT_REFUSAL_COPY } from '#/shared/domain/portal-print-refusals'
import type { PrintShareChoice } from './print-state'
import { usePrint, type PrintState } from './use-print'
import { PrintDownloadButton } from './portal-print-section'

const view: PortalPrintKitView = {
  portalId: 'portal-1',
  kit: 'final',
  portalName: 'Reception',
  primaryLocale: 'en',
  locales: ['en'],
  titles: { en: 'Reception' },
  lastPrint: null,
  savedWording: null,
  look: {
    wordmark: 'Hotel',
    propertyName: 'W'.repeat(60),
    logoUrl: null,
    heroUrl: null,
    heroSize: null,
    heroFocal: null,
    accentColour: '#A8C6FE',
    fieldColour: '#16224A',
  },
}

function stateFor(choice: Partial<PrintShareChoice>, read = view) {
  let state: PrintState | undefined
  function ReadState() {
    const printState = usePrint({
      portalId: view.portalId,
      view: read,
      enabled: true,
      countryCode: 'US',
      qrAddress: null,
      downloadMutation: undefined,
      saveWordingMutation: undefined,
      onDownloaded: () => undefined,
      onWordingSaved: () => undefined,
    })
    if (printState.choice.piece === 'tent') printState.change(choice)
    state = printState
    return createElement(PrintDownloadButton, {
      printState,
      unavailableReason: printState.refusal,
    })
  }
  const markup = renderToStaticMarkup(createElement(ReadState))
  if (state === undefined) throw new Error('Share state was not rendered')
  return { printState: state, markup }
}

describe('Share back containment', () => {
  it.each(
    (['counter', 'small'] as const).flatMap((piece) =>
      (['paper', 'immersive'] as const).flatMap((look) =>
        (['my_printer', 'print_shop'] as const).map((printer) => ({
          piece,
          look,
          printer,
        })),
      ),
    ),
  )('refuses an overflowing back on $piece $look $printer', (choice) => {
    const front = stateFor(choice)
    expect(front.printState.refusal).toBeNull()
    expect(front.printState.tile).not.toBeNull()
    expect(front.markup).not.toContain('disabled=""')

    const both = stateFor({ ...choice, backPage: true })
    expect(both.printState.refusal).toBe(PRINT_REFUSAL_COPY.words_do_not_fit)
    expect(both.printState.tile).not.toBeNull()
    expect(both.markup).toContain('disabled=""')

    const fitting = stateFor(
      { ...choice, backPage: true },
      { ...view, look: { ...view.look, propertyName: 'Hotel' } },
    )
    expect(fitting.printState.refusal).toBeNull()
    expect(fitting.markup).not.toContain('disabled=""')
  })
})
