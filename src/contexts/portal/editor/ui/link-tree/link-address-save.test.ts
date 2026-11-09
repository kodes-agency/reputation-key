import { describe, expect, it, vi } from 'vitest'
import { addressNeedsSave, saveLinkAddress } from './link-address-save'
import { FormApi } from '@tanstack/react-form'
import { createPortalDraftAutosave } from '../portal-draft-autosave'

describe('saving a link address', () => {
  it.each([false, true])(
    'preserves an address reverted during a pending form submit (rejected: %s)',
    async (rejectFirst) => {
      const initial = 'https://example.com/initial'
      const tracker = { saved: initial as string | null }
      const autosave = createPortalDraftAutosave()
      const writes: string[] = []
      let server = initial
      let release: () => void = () => undefined
      const form = new FormApi({
        defaultValues: { url: initial },
        onSubmit: async ({ value }) =>
          saveLinkAddress(value.url, tracker, async () => {
            writes.push(value.url)
            server = value.url
            if (writes.length === 1) {
              await new Promise<void>((resolve) => {
                release = resolve
              })
              if (rejectFirst) throw new Error('lost response')
            }
          }),
      })
      const unmount = form.mount()
      try {
        form.setFieldValue('url', 'https://example.com/edited')
        const first = autosave
          .write(() => form.handleSubmit())
          .then(
            () => 'saved',
            () => 'refused',
          )
        await vi.waitFor(() => expect(writes).toHaveLength(1))
        form.setFieldValue('url', initial)
        const second = autosave.write(() => form.handleSubmit())
        release()
        await second
        expect(await first).toBe(rejectFirst ? 'refused' : 'saved')
        expect(writes).toEqual(['https://example.com/edited', initial])
        expect(server).toBe(initial)
      } finally {
        unmount()
      }
    },
  )

  it('writes the old address again after a rejected request leaves the server uncertain', async () => {
    const initial = 'https://example.com/initial'
    const tracker = { saved: initial as string | null }
    let server = initial
    const send = vi.fn(async (value: string) => {
      server = value
      if (value !== initial) throw new Error('lost response')
    })
    await expect(
      saveLinkAddress('https://example.com/edited', tracker, () =>
        send('https://example.com/edited'),
      ),
    ).rejects.toThrow('lost response')
    expect(addressNeedsSave(initial, tracker.saved)).toBe(true)
    await saveLinkAddress(initial, tracker, () => send(initial))
    expect(server).toBe(initial)
    expect(send).toHaveBeenCalledTimes(2)
    expect(addressNeedsSave(initial, tracker.saved)).toBe(false)
  })

  it.each([
    [' front@example.com ', 'mailto:front@example.com'],
    ['+1 555 123 4567', 'tel:+15551234567'],
    ['https://example.com', 'https://example.com'],
  ])(
    'does not write a saved address in an equivalent field spelling: %s',
    async (value, saved) => {
      const write = vi.fn()
      await saveLinkAddress(value, { saved }, write)
      expect(write).not.toHaveBeenCalled()
    },
  )
})
