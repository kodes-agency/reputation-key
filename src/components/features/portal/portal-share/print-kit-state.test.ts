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
  printKitHasLiveVersion,
  printableFace,
  reconcilePrintKitChoice,
  unprintableCharacters,
} from './print-kit-state'

const CARD: PrintKitChoice = {
  style: 'paper',
  paper: 'letter',
  piece: 'counter_card',
  languages: ['en', 'bg'],
  callToAction: 'rate',
}
const TENT: PrintKitChoice = { ...CARD, piece: 'table_tent' }

describe('initialPrintKitChoice', () => {
  it('starts with a Paper counter card in the primary language and the next one, asking for a rating', () => {
    expect(initialPrintKitChoice(['en', 'bg'], 'US')).toEqual(CARD)
  })

  it('starts with the one language a single-language portal has', () => {
    expect(initialPrintKitChoice(['de'], 'US')).toEqual({
      ...CARD,
      languages: ['de'],
    })
  })

  it.each([
    ['the US', 'US', 'letter'],
    ['Canada', 'CA', 'letter'],
    ['Mexico', 'MX', 'letter'],
    ['Bulgaria', 'BG', 'a4'],
    ['Germany', 'DE', 'a4'],
    ['the UK', 'GB', 'a4'],
    ['a property with no country', null, 'letter'],
  ] as const)('starts a property in %s on %s paper', (_label, country, paper) => {
    expect(initialPrintKitChoice(['en'], country).paper).toBe(paper)
  })
})

describe('reconcilePrintKitChoice', () => {
  it("keeps the manager's choice while it is still offered", () => {
    const chosen = { ...TENT, languages: ['bg'] } as const
    expect(reconcilePrintKitChoice(chosen, ['en', 'bg'], 'US')).toBe(chosen)
  })

  it('keeps the paper the manager chose over the country’s', () => {
    const chosen = { ...CARD, paper: 'a4' } as const
    expect(reconcilePrintKitChoice(chosen, ['en', 'bg'], 'US').paper).toBe('a4')
  })

  it('starts again when a language it names is no longer offered', () => {
    expect(reconcilePrintKitChoice(CARD, ['en', 'es'], 'US')).toEqual({
      ...CARD,
      languages: ['en', 'es'],
    })
  })

  it('starts from the first choice when there is none yet', () => {
    expect(reconcilePrintKitChoice(null, ['en', 'bg'], 'BG')).toEqual({
      ...CARD,
      paper: 'a4',
    })
  })

  it('keeps the style, the paper, the piece and the call to action when only the languages have to change', () => {
    const chosen = {
      style: 'immersive',
      paper: 'a4',
      piece: 'counter_card',
      languages: ['fr'],
      callToAction: 'tell',
    } as const
    expect(reconcilePrintKitChoice(chosen, ['en', 'bg'], 'US')).toEqual({
      style: 'immersive',
      paper: 'a4',
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
    const marked = printKitFaces(TENT, { en: 'Pool 🏊', bg: 'Басейн 酒' }, 'Pool')

    expect(unprintableCharacters(look, marked)).toEqual(['🏊', '酒'])
  })

  it('draws the face without what the file drops, the place label included', () => {
    const [block] = printableFace({
      side: 'front',
      blocks: [
        {
          locale: 'en',
          kicker: 'Pool 酒',
          headline: 'Rate 🏊 now',
          subline: 'Тихо 酒',
        },
      ],
    }).blocks

    expect(block).toMatchObject({
      kicker: 'Pool ',
      headline: 'Rate  now',
      subline: 'Тихо ',
    })
  })

  it('names the characters in one line, and counts the rest past six', () => {
    expect(describeUnprintable(['Ω', 'ψ'])).toBe(
      'These characters will not print, because the print kit’s fonts don’t have them: Ω ψ.',
    )
    expect(describeUnprintable(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe(
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
