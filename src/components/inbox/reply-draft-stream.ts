import type { ReplyDraftingStreamEvent } from '#/contexts/ai/server/reply-progress-stream.server'
import type { ReplyLanguageTarget } from './reply-language-options'
import type { ReplyTone } from './reply-suggestion-contract'

export type DraftStreamRequest = Readonly<{
  reviewId: string
  tone: ReplyTone
  targetLanguage: ReplyLanguageTarget
  idempotencyKey: string
  intent: 'explicit' | 'background'
  trigger: 'draft' | 'try_again' | 'shorter' | 'tone'
  variation: number
  length?: 'short'
  maxWords?: number
}>
export type DraftStream = (
  request: DraftStreamRequest,
  signal: AbortSignal,
  receive: (event: ReplyDraftingStreamEvent) => void,
) => Promise<void>

/** Bounded NDJSON reader. Cancel delivery; never retry a provider request here. */
export async function readDraftStream(
  response: Response,
  signal: AbortSignal,
  receive: (event: ReplyDraftingStreamEvent) => void,
): Promise<void> {
  if (!response.ok || !response.body) throw new Error('Draft stream unavailable')
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += decoder.decode(chunk.value, { stream: true })
      if (pending.length > 65_536) throw new Error('Draft stream event too large')
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (line.trim()) receive(JSON.parse(line) as ReplyDraftingStreamEvent)
        newline = pending.indexOf('\n')
      }
    }
    if (!signal.aborted && pending.trim()) throw new Error('Incomplete draft stream')
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
