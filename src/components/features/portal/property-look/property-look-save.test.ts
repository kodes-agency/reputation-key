import { describe, expect, it, vi } from 'vitest'
import { lookDraftOf } from './property-look-rules'
import { runLookSave, runLocalesSave } from './property-look-save'

const SAVED = lookDraftOf({
  primaryColor: '#EAD6A8',
  backgroundColor: '#1B1410',
  backgroundMode: 'auto',
  wordmark: 'AVELA',
})

const profileOf = (accent: string) => ({
  primaryColor: accent,
  backgroundColor: '#1B1410',
  backgroundMode: 'auto' as const,
  wordmark: 'AVELA' as string | null,
})

describe('runLookSave', () => {
  it('writes an edited look and answers the look the server now holds', async () => {
    const save = vi.fn(async () => profileOf('#C8A45A'))

    const result = await runLookSave({
      propertyId: 'p-1',
      saved: SAVED,
      draft: { ...SAVED, accent: '#C8A45A' },
      save,
    })

    expect(save).toHaveBeenCalledWith({
      data: {
        propertyId: 'p-1',
        accentColour: '#C8A45A',
        backgroundMode: 'auto',
        wordmark: 'AVELA',
      },
    })
    expect(result).toEqual({
      outcome: 'saved',
      saved: lookDraftOf(profileOf('#C8A45A')),
    })
  })

  it('writes nothing when the draft is what the server holds', async () => {
    const save = vi.fn()

    const result = await runLookSave({
      propertyId: 'p-1',
      saved: SAVED,
      draft: { ...SAVED },
      save,
    })

    expect(result).toEqual({ outcome: 'unchanged', saved: SAVED })
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a draft the guest page could not read, with the reason, and writes nothing', async () => {
    const save = vi.fn()

    const result = await runLookSave({
      propertyId: 'p-1',
      saved: SAVED,
      draft: { ...SAVED, accent: '#1A1A2E' },
      save,
    })

    expect(result).toMatchObject({
      outcome: 'invalid',
      reason: 'This accent is hard to see on the page background',
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('lets a failed write reach the caller, which keeps the draft for a retry', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(
      runLookSave({
        propertyId: 'p-1',
        saved: SAVED,
        draft: { ...SAVED, accent: '#C8A45A' },
        save,
      }),
    ).rejects.toThrow('offline')
  })
})

describe('runLocalesSave', () => {
  it('writes the languages in order and answers what the server holds', async () => {
    const save = vi.fn(async () => ({ defaultGuestLocales: ['bg', 'en'] as const }))

    const result = await runLocalesSave({
      propertyId: 'p-1',
      saved: ['en', 'bg'],
      draft: ['bg', 'en'],
      save,
    })

    expect(save).toHaveBeenCalledWith({
      data: { propertyId: 'p-1', locales: ['bg', 'en'] },
    })
    expect(result).toEqual({ outcome: 'saved', saved: ['bg', 'en'] })
  })

  it('writes nothing when the order and the set are unchanged', async () => {
    const save = vi.fn()

    const result = await runLocalesSave({
      propertyId: 'p-1',
      saved: ['en', 'bg'],
      draft: ['en', 'bg'],
      save,
    })

    expect(result).toEqual({ outcome: 'unchanged', saved: ['en', 'bg'] })
    expect(save).not.toHaveBeenCalled()
  })
})
