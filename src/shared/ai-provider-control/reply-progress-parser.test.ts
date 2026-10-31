import { describe, expect, it } from 'vitest'
import { createReplyProgressParser } from './reply-progress-parser'
import {
  reportReplyProgress,
  type ReplyDraftingProgress,
} from '#/shared/reply-drafting-progress'

const output = JSON.stringify({
  languageCode: 'bg-Cyrl',
  case: 'complaint',
  mainPoint: [1, 2],
  avoidTerms: ['secret'],
  replyText: 'Съжаляваме за чакането. Вашето време заслужава повече внимание. "\\',
})
const expected = [{ step: 'answering', sentenceNumbers: [1, 2] }, { step: 'writing' }]

describe('content-free JSON prefix progress', () => {
  it('is safe at every UTF-8 byte boundary, including escapes and multibyte characters', () => {
    const bytes = new TextEncoder().encode(output)
    for (let split = 0; split <= bytes.length; split++) {
      const events: ReplyDraftingProgress[] = []
      const push = createReplyProgressParser([1, 2], (event) => events.push(event))
      const decoder = new TextDecoder('utf-8', { fatal: true })
      push(decoder.decode(bytes.slice(0, split), { stream: true }))
      push(decoder.decode(bytes.slice(split)))
      expect(events).toEqual(expected)
    }
  })
  it('emits answering only at a complete validated field and writing only at the first complete character', () => {
    const events: ReplyDraftingProgress[] = []
    const push = createReplyProgressParser([1], (event) => events.push(event))
    push('{"languageCode":"en-Latn","case":"complaint","mainPoint":[1]')
    expect(events).toEqual([])
    push(',"avoidTerms":[],"replyText":"\\u0')
    expect(events).toEqual([{ step: 'answering', sentenceNumbers: [1] }])
    push('041')
    expect(events).toEqual([
      { step: 'answering', sentenceNumbers: [1] },
      { step: 'writing' },
    ])
    expect(JSON.stringify(events)).not.toContain('replyText')
  })
  it.each(['[]', '[0]', '[1.2]', '[3]', '[1,2,3]', '["1"]'])(
    'never highlights an invalid selection %s',
    (mainPoint) => {
      const events: ReplyDraftingProgress[] = []
      createReplyProgressParser([1, 2], (event) => events.push(event))(
        `{"languageCode":"en","case":"complaint","mainPoint":${mainPoint},"avoidTerms":[],"replyText":"secret"}`,
      )
      expect(events).toEqual([])
    },
  )
  it('suppresses out-of-order fields, nested lookalikes, poisoned prefixes and oversize input', () => {
    for (const prefix of [
      '{"replyText":"secret",',
      '{"languageCode":{"mainPoint":[1]},',
      '{"languageCode":"en","case":"bad",',
      'x'.repeat(16_385),
    ]) {
      const events: ReplyDraftingProgress[] = []
      const push = createReplyProgressParser([1], (event) => events.push(event))
      push(prefix)
      push(output)
      expect(events).toEqual([])
    }
  })
  it('isolates a disconnected observer from execution', () => {
    expect(() =>
      reportReplyProgress(
        () => {
          throw new Error('Disconnected')
        },
        { step: 'thinking' },
      ),
    ).not.toThrow()
  })
})
