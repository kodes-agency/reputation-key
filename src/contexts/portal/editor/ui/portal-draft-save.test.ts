import { describe, expect, it, vi } from 'vitest'
import { trackDraftSave } from './portal-draft-save'
import { saveColoursDraft, saveFocalDraft, saveWordmarkDraft } from './portal-look-save'

const target = { propertyId: 'property', portalId: 'portal' }

describe('tracking a look save', () => {
  it.each(['colours', 'wordmark', 'focal'] as const)(
    'does not trust the old %s baseline after a request commits but rejects',
    async (field) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(new Error('lost response'))
        .mockResolvedValue({})
      const gold = {
        accent: '#B8860B',
        backgroundMode: 'auto',
        field: '#14110F',
      } as const
      const tracker = { saved: 'original' as string | null }
      const persist =
        field === 'wordmark'
          ? saveWordmarkDraft(target, send)
          : async (draft: string, saved: string | null) => {
              const result =
                field === 'colours'
                  ? await saveColoursDraft(target, send)(
                      draft === 'original' ? gold : { ...gold, accent: '#EAD6A8' },
                      saved === null ? null : gold,
                    )
                  : await saveFocalDraft(target, send)(
                      { x: draft === 'original' ? 0.5 : 0.7, y: 0.5 },
                      saved === null ? null : { x: 0.5, y: 0.5 },
                    )
              return {
                outcome: result.outcome,
                saved: result.saved === null ? null : draft,
              }
            }

      await expect(
        trackDraftSave(tracker, (saved) => persist('edited', saved)),
      ).rejects.toThrow('lost response')
      expect(tracker.saved).toBeNull()
      await expect(
        trackDraftSave(tracker, (saved) => persist('original', saved)),
      ).resolves.toBe('saved')
      expect(send).toHaveBeenCalledTimes(2)
      await expect(
        trackDraftSave(tracker, (saved) => persist('original', saved)),
      ).resolves.toBe('unchanged')
      expect(send).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps an unknown baseline when client validation refuses the next edit', async () => {
    const tracker = { saved: null as string | null }
    const send = vi.fn()
    await expect(
      trackDraftSave(tracker, (saved) =>
        saveWordmarkDraft(target, send)('W'.repeat(25), saved),
      ),
    ).resolves.toBe('invalid')
    expect(tracker.saved).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})
