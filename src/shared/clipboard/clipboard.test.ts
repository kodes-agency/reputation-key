// copyResolvedText hands the browser a promise for the text instead of the text,
// so the clipboard write starts inside the click's user activation even though
// the text arrives after a network wait (Safari drops the activation otherwise).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyResolvedText } from './clipboard'

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

function stubBrowser(write: (items: FakeClipboardItem[]) => Promise<void>) {
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } })
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
}

afterEach(() => vi.unstubAllGlobals())

describe('copyResolvedText', () => {
  it('starts the clipboard write before the text has arrived', async () => {
    let started = false
    let delivered: string | null = null
    stubBrowser(async ([item]) => {
      started = true
      const blob = await item!.items['text/plain']
      delivered = await blob!.text()
    })
    let release: (value: string | null) => void = () => undefined
    const pending = new Promise<string | null>((resolve) => {
      release = resolve
    })

    const outcome = copyResolvedText(() => pending)

    expect(started).toBe(true)
    release('https://example.test/p/abc')
    await expect(outcome).resolves.toEqual({ status: 'copied' })
    expect(delivered).toBe('https://example.test/p/abc')
  })

  it('reports nothing to copy, not a copy failure, when the text never arrives', async () => {
    stubBrowser(async ([item]) => {
      await item!.items['text/plain']
    })
    await expect(copyResolvedText(async () => null)).resolves.toEqual({
      status: 'unresolved',
    })
  })

  it('falls back to writing the arrived text, and hands it back when that fails too', async () => {
    stubBrowser(async () => {
      throw new Error('NotAllowedError')
    })
    const writeText = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    vi.stubGlobal('navigator', {
      clipboard: {
        write: async () => {
          throw new Error('NotAllowedError')
        },
        writeText,
      },
    })

    const outcome = await copyResolvedText(async () => 'https://example.test/p/abc')

    expect(outcome).toEqual({ status: 'failed', text: 'https://example.test/p/abc' })
    expect(writeText).toHaveBeenCalledWith('https://example.test/p/abc')
  })
})
