// The autosaved writes of a portal's own look: what is sent, when nothing is, and
// what the server then holds.
import { describe, expect, it, vi } from 'vitest'
import { saveColoursDraft, saveFocalDraft, saveWordmarkDraft } from './portal-look-save'

const TARGET = { propertyId: 'prop-1', portalId: 'portal-1' } as const

const GOLD = { accent: '#B8860B', backgroundMode: 'auto', field: '#14110F' } as const

describe('saving the colours', () => {
  it('writes nothing when the draft is what the server holds', async () => {
    const send = vi.fn()

    const result = await saveColoursDraft(TARGET, send)(GOLD, GOLD)

    expect(result).toEqual({ outcome: 'unchanged', saved: GOLD })
    expect(send).not.toHaveBeenCalled()
  })

  it('writes the portal’s colours and then holds the draft as saved', async () => {
    const send = vi.fn().mockResolvedValue({})
    const draft = { ...GOLD, accent: '#EAD6A8' }

    const result = await saveColoursDraft(TARGET, send)(draft, GOLD)

    expect(send).toHaveBeenCalledWith({
      data: {
        ...TARGET,
        colours: { mode: 'own', accentColour: '#EAD6A8', backgroundMode: 'auto' },
      },
    })
    expect(result).toEqual({ outcome: 'saved', saved: draft })
  })

  it('holds back colours the page cannot show and keeps what the server has', async () => {
    const send = vi.fn()
    const unreadable = {
      accent: '#B8860B',
      backgroundMode: 'manual',
      field: '#FFFFFF',
    } as const

    const result = await saveColoursDraft(TARGET, send)(unreadable, GOLD)

    expect(result).toEqual({ outcome: 'invalid', saved: GOLD })
    expect(send).not.toHaveBeenCalled()
  })

  it('holds back a colour that is not finished', async () => {
    const send = vi.fn()

    const result = await saveColoursDraft(TARGET, send)({ ...GOLD, accent: '#B8' }, GOLD)

    expect(result.outcome).toBe('invalid')
    expect(send).not.toHaveBeenCalled()
  })

  it('lets a refusal through, for the coordinator to report and retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('refused'))

    await expect(
      saveColoursDraft(TARGET, send)({ ...GOLD, accent: '#EAD6A8' }, GOLD),
    ).rejects.toThrow('refused')
  })
})

describe('saving the wordmark', () => {
  it('writes nothing for a wordmark that only differs in its spaces', async () => {
    const send = vi.fn()

    const result = await saveWordmarkDraft(TARGET, send)(' SPA ', 'SPA')

    expect(result.outcome).toBe('unchanged')
    expect(send).not.toHaveBeenCalled()
  })

  it('writes the wordmark alone, so the logo stays', async () => {
    const send = vi.fn().mockResolvedValue({})

    const result = await saveWordmarkDraft(TARGET, send)('SPA & POOLS', 'SPA')

    expect(send).toHaveBeenCalledWith({
      data: { ...TARGET, identity: { mode: 'own', wordmark: 'SPA & POOLS' } },
    })
    expect(result).toEqual({ outcome: 'saved', saved: 'SPA & POOLS' })
  })

  it('writes an emptied wordmark as none, so the business name shows', async () => {
    const send = vi.fn().mockResolvedValue({})

    await saveWordmarkDraft(TARGET, send)('', 'SPA')

    expect(send).toHaveBeenCalledWith({
      data: { ...TARGET, identity: { mode: 'own', wordmark: null } },
    })
  })

  it('holds back a wordmark that is too long', async () => {
    const send = vi.fn()

    const result = await saveWordmarkDraft(TARGET, send)('W'.repeat(25), 'SPA')

    expect(result).toEqual({ outcome: 'invalid', saved: 'SPA' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('saving the focus point', () => {
  it('writes nothing for a drag that ended where it began', async () => {
    const send = vi.fn()

    const result = await saveFocalDraft(TARGET, send)(
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.4 },
    )

    expect(result.outcome).toBe('unchanged')
    expect(send).not.toHaveBeenCalled()
  })

  it('writes the point alone, so the photo and its descriptions stay', async () => {
    const send = vi.fn().mockResolvedValue({})

    const result = await saveFocalDraft(TARGET, send)(
      { x: 0.62, y: 0.4 },
      { x: 0.5, y: 0.4 },
    )

    expect(send).toHaveBeenCalledWith({
      data: { ...TARGET, photo: { mode: 'own', focalX: 0.62, focalY: 0.4 } },
    })
    expect(result).toEqual({ outcome: 'saved', saved: { x: 0.62, y: 0.4 } })
  })
})
