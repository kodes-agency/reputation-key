import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { PrintFinalShareChoice } from './print-final-state'
import { usePrintFinal, type PrintFinalState } from './use-print-final'
import { PrintFinalDownloadButton } from './portal-print-final-section'

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

function stateFor(choice: Partial<PrintFinalShareChoice>, read = view) {
  let state: PrintFinalState | undefined
  function ReadState() {
    const final = usePrintFinal({
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
    if (final.choice.piece === 'tent') final.change(choice)
    state = final
    return createElement(PrintFinalDownloadButton, {
      final,
      unavailableReason: final.refusal,
    })
  }
  const markup = renderToStaticMarkup(createElement(ReadState))
  if (state === undefined) throw new Error('Share state was not rendered')
  return { final: state, markup }
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
    expect(front.final.refusal).toBeNull()
    expect(front.final.tile).not.toBeNull()
    expect(front.markup).not.toContain('disabled=""')

    const both = stateFor({ ...choice, backPage: true })
    expect(both.final.refusal).toBe(PRINT_FINAL_REFUSAL_COPY.words_do_not_fit)
    expect(both.final.tile).not.toBeNull()
    expect(both.markup).toContain('disabled=""')

    const fitting = stateFor(
      { ...choice, backPage: true },
      { ...view, look: { ...view.look, propertyName: 'Hotel' } },
    )
    expect(fitting.final.refusal).toBeNull()
    expect(fitting.markup).not.toContain('disabled=""')
  })
})
