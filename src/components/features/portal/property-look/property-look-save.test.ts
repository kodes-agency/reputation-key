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
      draft: { ...SAVED, backgroundMode: 'manual', field: '#E8E8E8' },
      save,
    })

    expect(result).toMatchObject({
      outcome: 'invalid',
      reason: 'Page text cannot be read on this background',
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('writes a wordmark edit on the default palette accent, which is hard to see on its field', async () => {
    const defaults = lookDraftOf({
      primaryColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      backgroundMode: 'auto',
      wordmark: null,
    })
    const save = vi.fn(async () => ({
      primaryColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      backgroundMode: 'auto' as const,
      wordmark: 'AVELA' as string | null,
    }))

    const result = await runLookSave({
      propertyId: 'p-1',
      saved: defaults,
      draft: { ...defaults, wordmark: 'AVELA' },
      save,
    })

    expect(result.outcome).toBe('saved')
    expect(save).toHaveBeenCalledWith({
      data: {
        propertyId: 'p-1',
        accentColour: '#2563EB',
        backgroundMode: 'auto',
        wordmark: 'AVELA',
      },
    })
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
