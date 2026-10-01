import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalDraftAutosave } from '../portal-editor/portal-draft-autosave'
import { afterPendingAutosaves } from './use-property-look-media'

describe('afterPendingAutosaves', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets a focal write that is still waiting or in flight land before the deliberate write starts', async () => {
    const autosave = createPortalDraftAutosave()
    const log: string[] = []
    let finishFocal: () => void = () => undefined
    autosave.schedule('photo-focal', async () => {
      log.push('focal started')
      await new Promise<void>((resolve) => {
        finishFocal = resolve
      })
      log.push('focal landed')
      return 'saved'
    })

    const result = afterPendingAutosaves(autosave, async () => {
      log.push('use photo started')
      return 'new photo'
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toEqual(['focal started'])

    finishFocal()
    await expect(result).resolves.toBe('new photo')
    expect(log).toEqual(['focal started', 'focal landed', 'use photo started'])
  })

  it('runs the write at once when nothing is waiting', async () => {
    const autosave = createPortalDraftAutosave()

    await expect(afterPendingAutosaves(autosave, async () => 'done')).resolves.toBe(
      'done',
    )
  })
})
