import { describe, expect, it, vi } from 'vitest'
import { readDraftStream } from './reply-draft-stream'
import { streamReplyDraft } from './use-reply-actions'
const { generateReplySuggestionStreamFn } = vi.hoisted(() => ({
  generateReplySuggestionStreamFn: vi.fn(),
}))
vi.mock('#/contexts/ai/server/reply-suggestion-stream', () => ({
  generateReplySuggestionStreamFn,
}))
describe('draft NDJSON delivery', () => {
  it('reads split UTF-8 and event boundaries once, through the lazy RPC', async () => {
    const encoded = new TextEncoder().encode(
      '{"step":"reading","sequence":1,"frame":{"prefix":"Здравейте","suffix":""}}\n{"step":"thinking","sequence":2}\n',
    )
    vi.mocked(generateReplySuggestionStreamFn).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoded.slice(0, 73))
            c.enqueue(encoded.slice(73))
            c.close()
          },
        }),
      ),
    )
    const receive = vi.fn()
    const controller = new AbortController()
    const data = {
      reviewId: 'review',
      tone: 'professional',
      targetLanguage: { kind: 'review_language' },
      idempotencyKey: 'key',
      intent: 'explicit',
      trigger: 'draft',
      variation: 0,
    } as const
    await streamReplyDraft(data, controller.signal, receive)
    expect(generateReplySuggestionStreamFn).toHaveBeenCalledWith({
      data,
      signal: controller.signal,
    })
    expect(receive.mock.calls).toEqual([
      [{ step: 'reading', sequence: 1, frame: { prefix: 'Здравейте', suffix: '' } }],
      [{ step: 'thinking', sequence: 2 }],
    ])
  })
  it('cancels the reader on Stop without delivering later bytes', async () => {
    const cancel = vi.fn()
    const receive = vi.fn()
    const controller = new AbortController()
    const response = new Response(new ReadableStream({ cancel }))
    const reading = readDraftStream(response, controller.signal, receive)
    controller.abort()
    await reading
    expect(cancel).toHaveBeenCalledOnce()
    expect(receive).not.toHaveBeenCalled()
  })
  it('rejects a truncated terminal event', async () => {
    await expect(
      readDraftStream(
        new Response('{"step":"done"'),
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('Incomplete')
  })
})
