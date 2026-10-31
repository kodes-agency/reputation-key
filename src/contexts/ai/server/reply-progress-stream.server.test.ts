import { beforeEach, describe, expect, it, vi } from 'vitest'
import { replyProgressResponse } from './reply-progress-stream.server'
import type { GenerateReplySuggestionResult } from '../application/public-api'

const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('#/shared/observability/logger', () => ({ getLogger: () => logs }))
beforeEach(() => vi.clearAllMocks())

const ready: GenerateReplySuggestionResult = {
  status: 'ready',
  profileVersion: 'reply-draft-v4',
  replyText: 'Checked and signed reply.',
  provenanceToken: 'signed',
  expiresAtEpochMillis: 5000,
  baseReplyStateRevision: 1,
  concreteLanguageTag: 'en-Latn',
  mainPoint: [1],
}

describe('raw NDJSON reply response', () => {
  it('delivers ordered metadata, one rewrite and the exact final acceptance result', async () => {
    const response = replyProgressResponse(async (emit) => {
      emit({ step: 'reading' })
      emit({ step: 'thinking' })
      emit({ step: 'answering', sentenceNumbers: [1] })
      emit({ step: 'writing' })
      emit({ step: 'checking' })
      emit({ step: 'thinking' })
      emit({ step: 'rewording', ordinal: 1 })
      emit({ step: 'thinking' })
      emit({ step: 'checking' })
      return ready
    }, 'explicit')
    expect(response.headers.get('content-type')).toBe(
      'application/x-ndjson; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.map((e) => e.step)).toEqual([
      'reading',
      'thinking',
      'answering',
      'writing',
      'checking',
      'rewording',
      'thinking',
      'checking',
      'done',
    ])
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(events.at(-1).result).toEqual(ready)
    expect(JSON.stringify(events.slice(0, -1))).not.toMatch(
      /replyText|avoidTerms|Checked/,
    )
    expect(logs.info).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'done',
        contract: 'reply-suggestion-v2',
        intent: 'explicit',
        durationMs: expect.any(Number),
        rewrite: true,
      },
      'Reply drafting stream outcome',
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toMatch(/replyText|signed|Checked/)
  })
  it('maps an unexpected explicit run failure and logs only its name and code', async () => {
    const response = replyProgressResponse(async () => {
      throw Object.assign(new TypeError('private provider text'), { code: 'unexpected' })
    }, 'explicit')
    expect(JSON.parse((await response.text()).trim())).toEqual({
      step: 'refused',
      reason: 'provider_unavailable',
      retryAfterEpochMillis: null,
      sequence: 1,
    })
    expect(logs.error).toHaveBeenCalledExactlyOnceWith(
      {
        errorName: 'TypeError',
        errorCode: 'unexpected',
      },
      'Reply drafting stream failed',
    )
    expect(logs.info).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'refused',
        contract: 'reply-suggestion-v2',
        intent: 'explicit',
        durationMs: expect.any(Number),
        rewrite: false,
      },
      'Reply drafting stream outcome',
    )
    expect(JSON.stringify([logs.info.mock.calls, logs.error.mock.calls])).not.toContain(
      'private provider text',
    )
  })
  it.each(['language_not_personalized', 'no_review_text'] as const)(
    'delivers the governed %s fallback unchanged',
    async (reason) => {
      const fallback: GenerateReplySuggestionResult = {
        status: 'fallback',
        kind: 'local_safe_template',
        reason,
        languageSource: 'property_default',
        replyText: 'Governed local template.',
        concreteLanguageTag: 'fr-Latn',
      }
      const response = replyProgressResponse(async () => fallback, 'explicit')
      expect(JSON.parse((await response.text()).trim())).toEqual({
        step: 'done',
        result: fallback,
        sequence: 1,
      })
    },
  )
  it.each(['unavailable', 'throw'] as const)(
    'defers background %s quietly with a controlled terminal event',
    async (outcome) => {
      const response = replyProgressResponse(async () => {
        if (outcome === 'throw') throw new Error('provider secret')
        return { status: 'unavailable', code: 'busy', retryAfterEpochMillis: 10 }
      }, 'background')
      expect(await response.text()).toBe(
        JSON.stringify({
          step: 'deferred',
          retryAfterEpochMillis: outcome === 'throw' ? null : 10,
          sequence: 1,
        }) + '\n',
      )
      expect(logs.info).toHaveBeenCalledExactlyOnceWith(
        {
          event: 'deferred',
          contract: 'reply-suggestion-v2',
          intent: 'background',
          durationMs: expect.any(Number),
          rewrite: false,
        },
        'Reply drafting stream outcome',
      )
    },
  )
  it('continues the operation after browser cancel and drops its final text', async () => {
    let finish!: (result: GenerateReplySuggestionResult) => void
    const settled = vi.fn()
    const response = replyProgressResponse(async (emit) => {
      emit({ step: 'reading' })
      const result = await new Promise<GenerateReplySuggestionResult>((resolve) => {
        finish = resolve
      })
      settled()
      emit({ step: 'checking' })
      return result
    }, 'explicit')
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    finish(ready)
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(logs.info).toHaveBeenCalledExactlyOnceWith(
        {
          event: 'cancelled',
          contract: 'reply-suggestion-v2',
          intent: 'explicit',
          durationMs: expect.any(Number),
          rewrite: false,
        },
        'Reply drafting stream outcome',
      ),
    )
    expect(await reader.read()).toEqual({ done: true, value: undefined })
  })
})

it('closes an aborted browser stream while allowing settlement to finish', async () => {
  const browser = new AbortController()
  let finish!: (result: GenerateReplySuggestionResult) => void
  const settled = vi.fn()
  const response = replyProgressResponse(
    async (emit) => {
      emit({ step: 'reading' })
      const result = await new Promise<GenerateReplySuggestionResult>((resolve) => {
        finish = resolve
      })
      settled()
      return result
    },
    'explicit',
    browser.signal,
  )
  const reader = response.body!.getReader()
  await reader.read()
  browser.abort()
  expect(await reader.read()).toEqual({ done: true, value: undefined })
  finish(ready)
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
})
