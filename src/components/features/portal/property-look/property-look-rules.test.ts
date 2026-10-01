import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { readLookContrast } from '#/shared/domain/portal-look-readout'
import {
  affectedPortals,
  describeLookStatus,
  customFieldOf,
  languageSetOf,
  lookDraftOf,
  lookInputOf,
  lookIsUnchanged,
  lookProblemOf,
  parseColourInput,
  ratioText,
  readoutRows,
  refusalOf,
  describeAffected,
  type AffectedPortalRow,
} from './property-look-rules'

const PROFILE = {
  displayName: 'Avela Resort',
  primaryColor: '#EAD6A8',
  backgroundColor: '#1B1410',
  backgroundMode: 'auto' as const,
  wordmark: 'AVELA' as string | null,
  defaultGuestLocales: ['en', 'bg'] as const,
}

const row = (
  name: string,
  publicationState: AffectedPortalRow['publicationState'],
  group: string | null = null,
): AffectedPortalRow => ({
  portalId: name.toLowerCase(),
  name,
  publicationState,
  group: group === null ? null : { id: group, name: group },
})

describe('parseColourInput', () => {
  it.each([
    ['#ead6a8', '#EAD6A8'],
    ['EAD6A8', '#EAD6A8'],
    ['  #ead6a8 ', '#EAD6A8'],
    ['#eda', '#EEDDAA'],
    ['fff', '#FFFFFF'],
  ])('reads %j as %s', (text, colour) => {
    expect(parseColourInput(text)).toBe(colour)
  })

  it.each(['', '#', '#12', '#12345', '#1234567', 'gold', '#GGGGGG'])(
    'does not read %j',
    (text) => {
      expect(parseColourInput(text)).toBeNull()
    },
  )
})

describe('lookDraftOf and lookInputOf', () => {
  it('starts from the saved profile, with no wordmark as an empty field', () => {
    expect(lookDraftOf(PROFILE)).toEqual({
      accent: '#EAD6A8',
      backgroundMode: 'auto',
      field: '#1B1410',
      wordmark: 'AVELA',
    })
    expect(lookDraftOf({ ...PROFILE, wordmark: null }).wordmark).toBe('')
  })

  it('sends the field only when the background is manual, and an empty wordmark as none', () => {
    const draft = lookDraftOf({ ...PROFILE, wordmark: null })

    expect(lookInputOf('p-1', draft)).toEqual({
      propertyId: 'p-1',
      accentColour: '#EAD6A8',
      backgroundMode: 'auto',
      wordmark: null,
    })
    expect(lookInputOf('p-1', { ...draft, backgroundMode: 'manual' })).toMatchObject({
      backgroundMode: 'manual',
      backgroundColour: '#1B1410',
    })
  })

  it('compares drafts by what would be written', () => {
    const saved = lookDraftOf(PROFILE)

    expect(lookIsUnchanged(saved, { ...saved })).toBe(true)
    expect(lookIsUnchanged(saved, { ...saved, accent: '#C8A45A' })).toBe(false)
    expect(lookIsUnchanged(saved, { ...saved, wordmark: ' AVELA ' })).toBe(true)
    // A background nobody uses does not make an edit while the mode is automatic.
    expect(lookIsUnchanged(saved, { ...saved, field: '#000000' })).toBe(true)
    expect(
      lookIsUnchanged(
        { ...saved, backgroundMode: 'manual' },
        { ...saved, backgroundMode: 'manual', field: '#000000' },
      ),
    ).toBe(false)
  })
})

describe('lookProblemOf', () => {
  const draft = lookDraftOf(PROFILE)

  it('finds nothing wrong with the board look', () => {
    expect(lookProblemOf(draft)).toBeNull()
  })

  it('names a field that light text cannot be read on, and a long wordmark', () => {
    expect(
      lookProblemOf({ ...draft, backgroundMode: 'manual', field: '#E8E8E8' }),
    ).toMatch(/background/i)
    expect(lookProblemOf({ ...draft, wordmark: 'A'.repeat(25) })).toMatch(/24/)
  })

  it('does not refuse an accent that is hard to see on its field: the page covers it', () => {
    // The default palette every Property starts with, and the legacy indigo.
    expect(lookProblemOf({ ...draft, accent: '#2563EB' })).toBeNull()
    expect(lookProblemOf({ ...draft, accent: '#6366F1' })).toBeNull()
    expect(lookProblemOf({ ...draft, accent: '#1A1A2E' })).toBeNull()
  })

  it('asks for six hex digits when a colour is not complete', () => {
    expect(lookProblemOf({ ...draft, accent: '#EAD' })).toMatch(/six hex digits/i)
  })
})

describe('customFieldOf', () => {
  const draft = lookDraftOf({ ...PROFILE, backgroundColor: '#FFFFFF' })

  it('seeds the custom background with the field the page paints, when the stored colour is light', () => {
    const seeded = customFieldOf(draft)

    expect(seeded).not.toBe('#FFFFFF')
    expect(
      lookProblemOf({ ...draft, backgroundMode: 'manual', field: seeded }),
    ).toBeNull()
  })

  it('keeps a stored colour that light text can be read on', () => {
    expect(customFieldOf({ ...draft, field: '#1B1410' })).toBe('#1B1410')
  })
})

describe('refusalOf', () => {
  it('is the server sentence for a 4xx refusal, and nothing for a failure that a retry could fix', () => {
    expect(
      refusalOf(
        new ServerFunctionError('PortalError', 'Portals are switched off', 'x', 403),
      ),
    ).toBe('Portals are switched off')
    expect(
      refusalOf(new ServerFunctionError('InternalError', 'boom', 'internal', 500)),
    ).toBeNull()
    expect(refusalOf(new Error('offline'))).toBeNull()
    expect(refusalOf(null)).toBeNull()
  })
})

describe('readoutRows and ratioText', () => {
  it('rounds a ratio down so a pair is never shown as passing by rounding', () => {
    expect(ratioText(11.87)).toBe('11.8:1')
    expect(ratioText(4.49)).toBe('4.4:1')
    expect(ratioText(21)).toBe('21.0:1')
  })

  it('lists the button text and the small text, as the board does, with a verdict each', () => {
    const readout = readLookContrast({
      accent: '#EAD6A8',
      backgroundMode: 'auto',
      backgroundColour: '#FFFFFF',
    })
    if (!readout) throw new Error('expected a readout')

    const rows = readoutRows(readout)

    expect(rows.map((entry) => entry.label)).toEqual([
      'Button text',
      'Small text on the colour field',
      'Accent on the colour field',
    ])
    expect(rows.every((entry) => entry.verdict === 'Readable')).toBe(true)
    expect(rows[0]?.ratio).toMatch(/^\d+\.\d:1$/)
  })

  it('says hard to read for a pair below its minimum, and for the accent that guests see as light text', () => {
    const readout = readLookContrast({
      accent: '#2563EB',
      backgroundMode: 'auto',
      backgroundColour: '#FFFFFF',
    })
    if (!readout) throw new Error('expected a readout')

    const hard = readoutRows(readout).find((entry) => !entry.isReadable)

    expect(hard).toMatchObject({
      label: 'Accent on the colour field',
      verdict: 'Hard to read',
      note: 'guests see it as light text',
    })
    expect(readoutRows(readout).filter((entry) => entry.note !== null)).toHaveLength(1)
  })
})

describe('affectedPortals', () => {
  it('counts live and draft portals and leaves out archived and switched-off ones', () => {
    const result = affectedPortals([
      row('Reception', 'published'),
      row('Pool', 'published'),
      row('Bar', 'draft'),
      row('Old', 'archived'),
      row('Paused', 'disabled'),
    ])

    expect(result.live.map((entry) => entry.name)).toEqual(['Reception', 'Pool'])
    expect(result.drafts.map((entry) => entry.name)).toEqual(['Bar'])
    expect(result.listed.map((entry) => entry.name)).toEqual(['Reception', 'Pool', 'Bar'])
  })

  it('describes them as the board does', () => {
    const two = affectedPortals([
      row('A', 'published'),
      row('B', 'published'),
      row('C', 'draft'),
    ])

    expect(describeAffected(two)).toBe('2 live · 1 draft')
    expect(describeAffected(affectedPortals([row('A', 'published')]))).toBe('1 live')
    expect(describeAffected(affectedPortals([row('A', 'draft')]))).toBe('1 draft')
    expect(describeAffected(affectedPortals([]))).toBe('No portals yet')
  })
})

describe('describeLookStatus', () => {
  const none = affectedPortals([])
  const five = affectedPortals(
    ['A', 'B', 'C', 'D', 'E'].map((name) => row(name, 'published')),
  )

  it('says how many live portals use the look, and whether the edits are saved', () => {
    expect(describeLookStatus({ status: 'saved' }, five).text).toBe(
      'Saved as a draft · 5 live portals use this look',
    )
    expect(describeLookStatus({ status: 'idle' }, five).text).toBe(
      '5 live portals use this look',
    )
    expect(
      describeLookStatus({ status: 'saved' }, affectedPortals([row('A', 'published')]))
        .text,
    ).toBe('Saved as a draft · 1 live portal uses this look')
    expect(describeLookStatus({ status: 'saved' }, none).text).toBe(
      'Saved as a draft · no live portal uses this look yet',
    )
  })

  it('shows saving, a refused edit with its reason, and a failed one with a retry', () => {
    expect(describeLookStatus({ status: 'saving' }, five)).toMatchObject({
      text: 'Saving…',
      tone: 'busy',
    })
    expect(describeLookStatus({ status: 'pending' }, five).tone).toBe('busy')
    expect(
      describeLookStatus({ status: 'invalid', reason: 'Too long' }, five),
    ).toMatchObject({
      text: 'Not saved · Too long',
      tone: 'warn',
      canRetry: false,
    })
    expect(describeLookStatus({ status: 'error' }, five)).toMatchObject({
      text: 'Not saved',
      tone: 'warn',
      canRetry: true,
    })
  })

  it('shows the server reason for a refused save and offers no retry, which cannot fix it', () => {
    expect(
      describeLookStatus(
        { status: 'error', reason: 'Portals are switched off here' },
        five,
      ),
    ).toMatchObject({
      text: 'Not saved · Portals are switched off here',
      tone: 'warn',
      canRetry: false,
    })
  })
})

describe('languageSetOf', () => {
  it('splits the ordered list into the fallback and the others', () => {
    expect(languageSetOf(['bg', 'en'])).toEqual({ primary: 'bg', additional: ['en'] })
    expect(languageSetOf(['en'])).toEqual({ primary: 'en', additional: [] })
  })
})
