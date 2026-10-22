import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { printKitFaces, type PrintKitChoice } from '#/shared/domain/portal-print-kit'
import {
  describePrintKitNotLive,
  describeUnprintable,
  initialPrintKitChoice,
  isNothingLiveRefusal,
  languageChoiceLabel,
  printKitAvailability,
  printKitCaptions,
  printKitHasLiveVersion,
  printKitPreviewLabel,
  printKitPrintAdvice,
  printableFace,
  reconcilePrintKitChoice,
  unprintableCharacters,
} from './print-kit-state'

const TENT: PrintKitChoice = {
  piece: 'table_tent',
  languages: ['en', 'bg'],
  callToAction: 'rate',
}

describe('initialPrintKitChoice', () => {
  it('starts with a table tent in the primary language and the next one, asking for a rating', () => {
    expect(initialPrintKitChoice(['en', 'bg'])).toEqual(TENT)
  })

  it('starts with the one language a single-language portal has', () => {
    expect(initialPrintKitChoice(['de'])).toEqual({
      piece: 'table_tent',
      languages: ['de'],
      callToAction: 'rate',
    })
  })
})

describe('reconcilePrintKitChoice', () => {
  it("keeps the manager's choice while it is still offered", () => {
    const chosen = { ...TENT, piece: 'counter_card', languages: ['bg'] } as const
    expect(reconcilePrintKitChoice(chosen, ['en', 'bg'])).toBe(chosen)
  })

  it('starts again when a language it names is no longer offered', () => {
    expect(reconcilePrintKitChoice(TENT, ['en', 'es'])).toEqual({
      piece: 'table_tent',
      languages: ['en', 'es'],
      callToAction: 'rate',
    })
  })

  it('starts from the first choice when there is none yet', () => {
    expect(reconcilePrintKitChoice(null, ['en', 'bg'])).toEqual(TENT)
  })

  it('keeps the piece and the call to action when only the languages have to change', () => {
    const chosen = {
      piece: 'counter_card',
      languages: ['fr'],
      callToAction: 'tell',
    } as const
    expect(reconcilePrintKitChoice(chosen, ['en', 'bg'])).toEqual({
      piece: 'counter_card',
      languages: ['en', 'bg'],
      callToAction: 'tell',
    })
  })
})

describe('languageChoiceLabel', () => {
  it('names each language in its own words', () => {
    expect(languageChoiceLabel(['en', 'bg'])).toBe('English + Български')
    expect(languageChoiceLabel(['es'])).toBe('Español')
  })
})

describe('printKitCaptions', () => {
  it('says what is shown, its size and the quiet zone, and what the PDF holds', () => {
    expect(printKitCaptions('table_tent', 'front')).toEqual({
      top: 'Table tent A6 · front · 105 × 148 mm · QR with a 4-module quiet zone',
      bottom: 'PDF: one folded sheet with a fold mark, 3 mm bleed and crop marks',
    })
    expect(printKitCaptions('counter_card', 'back').top).toBe(
      'Counter card A6 · back · 105 × 148 mm · QR with a 4-module quiet zone',
    )
    expect(printKitCaptions('counter_card', 'back').bottom).toBe(
      'PDF: one A6 page per side, with 3 mm bleed and crop marks',
    )
  })
})

describe('printKitPreviewLabel', () => {
  it('describes the face for a screen reader', () => {
    const [front] = printKitFaces(TENT, {}, 'Pool')
    expect(front && printKitPreviewLabel(TENT.piece, front)).toBe(
      'Print preview: table tent, front, English and Bulgarian, "Rate your visit", the QR code on a light plate and the address as text',
    )
  })
})

describe('printKitAvailability', () => {
  it('is ready when the address can be fetched again', () => {
    expect(printKitAvailability({ canDownloadAgain: true })).toEqual({
      ready: true,
      reason: null,
    })
  })

  it('says why not, and how to get there, when the code did not keep its address', () => {
    const availability = printKitAvailability({ canDownloadAgain: false })
    expect(availability.ready).toBe(false)
    expect(availability.reason).toMatch(/replace the code/iu)
  })
})

describe('printKitPrintAdvice', () => {
  it('sends the table tent to a print shop: its sheet is taller than A4 and Letter', () => {
    expect(printKitPrintAdvice('table_tent')).toBe(
      'The table tent needs a print shop: its sheet is larger than A4 or Letter. Ask them to print it at 100% (actual size) and cut it on the crop marks. Ask your print shop to convert to CMYK if they need it.',
    )
  })

  it('prints the counter card on A4 or Letter, at actual size', () => {
    expect(printKitPrintAdvice('counter_card')).toBe(
      'Print the counter card on A4 or Letter at 100% (actual size), not “fit to page”, then cut on the crop marks. Ask your print shop to convert to CMYK if they need it.',
    )
  })

  it('tells a print shop what to do about the file’s RGB colours, for both pieces', () => {
    for (const piece of ['table_tent', 'counter_card'] as const) {
      expect(printKitPrintAdvice(piece)).toMatch(
        /Ask your print shop to convert to CMYK if they need it\.$/,
      )
    }
  })

  it('never offers an office printer for a piece whose page is larger than the paper', () => {
    for (const piece of ['table_tent', 'counter_card'] as const) {
      expect(printKitPrintAdvice(piece)).toMatch(/100% \(actual size\)/)
    }
  })
})

describe('printKitHasLiveVersion', () => {
  it('is true only for a published portal: a draft never had a live version, and turning off or archiving ends it', () => {
    expect(printKitHasLiveVersion('published')).toBe(true)
    expect(printKitHasLiveVersion('draft')).toBe(false)
    expect(printKitHasLiveVersion('disabled')).toBe(false)
    expect(printKitHasLiveVersion('archived')).toBe(false)
  })

  it('lets the read decide when the tab was not told the state', () => {
    expect(printKitHasLiveVersion(undefined)).toBe(true)
  })
})

describe('isNothingLiveRefusal', () => {
  it('recognises the server’s refusal for a portal with nothing live', () => {
    const refusal = new ServerFunctionError(
      'PortalError',
      'Publish this Portal before printing it: a print carries the live code.',
      'publication_snapshot_unavailable',
      409,
    )
    expect(isNothingLiveRefusal(refusal)).toBe(true)
  })

  it('leaves every other failure to the generic message and its Try again', () => {
    expect(
      isNothingLiveRefusal(
        new ServerFunctionError('PortalError', 'busy', 'rate_limited', 429),
      ),
    ).toBe(false)
    expect(
      isNothingLiveRefusal(
        new ServerFunctionError(
          'PortalError',
          'portal not found',
          'portal_not_found',
          404,
        ),
      ),
    ).toBe(false)
    expect(isNothingLiveRefusal(new Error('Print kit unavailable'))).toBe(false)
    expect(isNothingLiveRefusal(null)).toBe(false)
  })
})

describe('describePrintKitNotLive', () => {
  const where = { portalId: 'portal-1', propertyId: 'property-1' }
  const review = { propertyId: 'property-1', portalId: 'portal-1' }

  it('asks a draft to be published, and why: a print carries the live code', () => {
    expect(describePrintKitNotLive('draft', where)).toEqual({
      body: 'Publish this portal to make a print kit. A print carries the code of the live page.',
      review,
    })
  })

  it('asks a portal that was turned off to be published again', () => {
    expect(describePrintKitNotLive('disabled', where)).toEqual({
      body: 'Publish this portal again to make a print kit. A print carries the code of the live page.',
      review,
    })
  })

  it('sends an archived portal to the Portals list, where it is restored, not to the review', () => {
    expect(describePrintKitNotLive('archived', where)).toEqual({
      body: 'Restore this portal from the Portals list and publish it to make a print kit. A print carries the code of the live page.',
      review: null,
    })
  })

  it('uses the draft’s words when the server says nothing is live though the page thought so', () => {
    expect(describePrintKitNotLive('published', where)).toEqual(
      describePrintKitNotLive('draft', where),
    )
    expect(describePrintKitNotLive(undefined, where)).toEqual(
      describePrintKitNotLive('draft', where),
    )
  })

  it('offers no link to the review when the tab was not told the property', () => {
    expect(describePrintKitNotLive('draft', { portalId: 'portal-1' }).review).toBeNull()
  })
})

describe('what the fonts cannot print', () => {
  const look = { wordmark: 'Avela', logoUrl: null }
  const faces = printKitFaces(
    TENT,
    { en: 'Pool & Terrace', bg: 'Басейн и тераса' },
    'Pool',
  )

  it('names nothing for the launch languages', () => {
    expect(unprintableCharacters(look, faces)).toEqual([])
    expect(describeUnprintable([])).toBeNull()
  })

  it('names the characters of a brand set as words, in capitals as the file sets it', () => {
    expect(unprintableCharacters({ wordmark: 'Αθήνα', logoUrl: null }, faces)).toEqual([
      'Α',
      'Θ',
      'Ή',
      'Ν',
    ])
  })

  it('ignores the wordmark while a logo stands in for it', () => {
    expect(
      unprintableCharacters(
        { wordmark: 'Αθήνα', logoUrl: 'https://x.test/logo.png' },
        faces,
      ),
    ).toEqual([])
  })

  it('names what a title carries on any face of the print', () => {
    const greek = printKitFaces(TENT, { en: 'Pool 🏊', bg: 'Басейн 酒' }, 'Pool')

    expect(unprintableCharacters(look, greek)).toEqual(['🏊', '酒'])
  })

  it('draws the face without what the file drops', () => {
    const [block] = printableFace({
      side: 'front',
      blocks: [
        { locale: 'en', kicker: 'Pool', headline: 'Rate 🏊 now', subline: 'Тихо 酒' },
      ],
    }).blocks

    expect(block).toMatchObject({ headline: 'Rate  now', subline: 'Тихо ' })
  })

  it('names the characters in one line, and counts the rest past six', () => {
    expect(describeUnprintable(['Ω', 'ψ'])).toBe(
      'These characters will not print, because the print kit’s fonts don’t have them: Ω ψ.',
    )
    expect(
      describeUnprintable(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => c)),
    ).toBe(
      'These characters will not print, because the print kit’s fonts don’t have them: a b c d e f and 2 more.',
    )
  })

  it('leaves out characters with nothing to show, such as an emoji’s variation selector', () => {
    expect(describeUnprintable(['🏊', '\uFE0F'])).toBe(
      'These characters will not print, because the print kit’s fonts don’t have them: 🏊.',
    )
    expect(describeUnprintable(['\uFE0F'])).toBeNull()
  })
})
