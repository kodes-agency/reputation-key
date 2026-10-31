import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyDraftSession,
  scheduleBackgroundDraft,
  draftReviewTextDigest,
} from './reply-draft-session'
import type { DraftStream } from './reply-draft-stream'
import type { ReplyDraftingStreamEvent } from '#/contexts/ai/server/reply-progress-stream.server'

const options = {
  tone: 'professional',
  targetLanguage: { kind: 'property_default' },
  trigger: 'draft',
} as const
const fallback = {
  status: 'fallback',
  kind: 'local_safe_template',
  replyText: 'A safe local starting point.',
  concreteLanguageTag: 'en-Latn',
  reason: 'no_review_text',
  languageSource: 'property_default',
} as const
function harness() {
  let receive: (event: ReplyDraftingStreamEvent) => void = () => {}
  let finish = () => {}
  const stream = vi.fn<DraftStream>((_, signal, next) => {
    receive = next
    return new Promise<void>((resolve) => {
      finish = resolve
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  })
  const session = createReplyDraftSession('review', stream)
  return {
    stream,
    session,
    event: (event: ReplyDraftingStreamEvent) => receive(event),
    finish: () => finish(),
  }
}
afterEach(() => vi.useRealTimers())
describe('detail-owned drafting session', () => {
  it('shows the known local voice immediately and retains it after Stop', () => {
    const h = harness()
    const frame = { prefix: 'Hello Anna,', suffix: 'Kind regards, Our team' }
    h.session.seedFrame(frame)
    void h.session.request(options)
    expect(h.session.getSnapshot()).toMatchObject({ running: true, frame })
    h.session.stop()
    void h.session.request(options)
    expect(h.session.getSnapshot()).toMatchObject({ running: true, frame })
    h.session.dispose()
  })
  it('cancels the actual dwell on navigation and never lets dwell replace explicit work', async () => {
    vi.useFakeTimers()
    const h = harness()
    const cancel = scheduleBackgroundDraft(h.session, options.targetLanguage)
    vi.advanceTimersByTime(1999)
    expect(h.stream).not.toHaveBeenCalled()
    cancel()
    vi.advanceTimersByTime(1)
    expect(h.stream).not.toHaveBeenCalled()
    scheduleBackgroundDraft(h.session, options.targetLanguage)
    void h.session.request({ ...options, tone: 'friendly', trigger: 'tone' })
    vi.advanceTimersByTime(2000)
    expect(h.stream).toHaveBeenCalledOnce()
    expect(h.session.getSnapshot()).toMatchObject({
      visible: true,
      running: true,
      options: { tone: 'friendly' },
    })
    h.session.dispose()
    expect(await draftReviewTextDigest('Original words.')).not.toBe(
      await draftReviewTextDigest('Translated words.'),
    )
  })
  it('starts exactly one hidden stream when an eligible dwell completes', () => {
    vi.useFakeTimers()
    const h = harness()
    scheduleBackgroundDraft(h.session, options.targetLanguage)
    vi.advanceTimersByTime(2000)
    expect(h.stream).toHaveBeenCalledOnce()
    expect(h.stream.mock.calls[0]![0].intent).toBe('background')
    expect(h.session.getSnapshot().visible).toBe(false)
    h.session.dispose()
  })
  it('uses an interactive successor if the manager joins a deferred background stream', async () => {
    const h = harness()
    const result = h.session.request(options, true)
    const joined = h.session.request(options)
    h.event({ sequence: 1, step: 'deferred', retryAfterEpochMillis: null })
    h.finish()
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2))
    h.event({ sequence: 1, step: 'done', result: fallback })
    h.finish()
    expect(await joined).toEqual(fallback)
    expect(await result).toEqual(fallback)
    expect(h.stream.mock.calls[1]![0].intent).toBe('explicit')
  })
  it('evicts an expired ready draft instead of trapping every later Draft click', async () => {
    const h = harness()
    const result = h.session.request(options, true)
    h.event({
      sequence: 1,
      step: 'done',
      result: {
        status: 'ready',
        profileVersion: 'reply-draft-v4',
        replyText: 'An expired draft.',
        provenanceToken: 'token',
        expiresAtEpochMillis: Date.now() - 1,
        concreteLanguageTag: 'en-Latn',
        baseReplyStateRevision: 0,
      },
    })
    h.finish()
    await result
    void h.session.request(options)
    expect(h.stream).toHaveBeenCalledTimes(2)
    h.session.dispose()
  })
  it('joins hidden background work at its current step and retains completed results across subscriptions', async () => {
    const h = harness()
    const background = h.session.request(options, true)
    h.event({
      sequence: 1,
      step: 'reading',
      frame: { prefix: 'Hello Anna,', suffix: 'Kind regards,\nOur team' },
    })
    h.event({ sequence: 2, step: 'answering', sentenceNumbers: [2] })
    expect(h.session.getSnapshot()).toMatchObject({
      visible: false,
      running: true,
      sentences: [2],
    })
    const detach = h.session.subscribe(vi.fn())
    detach()
    const joined = h.session.request(options)
    expect(joined).toBe(background)
    expect(h.stream).toHaveBeenCalledOnce()
    expect(h.session.getSnapshot()).toMatchObject({
      visible: true,
      progress: { step: 'answering' },
    })
    h.event({ sequence: 3, step: 'done', result: fallback })
    h.finish()
    expect(await joined).toEqual(fallback)
    expect(await h.session.request(options)).toEqual(fallback)
    expect(h.stream).toHaveBeenCalledOnce()
    h.session.dismiss()
    expect(h.session.getSnapshot()).toMatchObject({ visible: false, sentences: [] })
  })
  it('typing evicts held background results and fences in-flight delivery and re-joins', async () => {
    const h = harness()
    const background = h.session.request(options, true)
    h.event({
      sequence: 1,
      step: 'done',
      result: {
        status: 'ready',
        profileVersion: 'reply-draft-v4',
        replyText: 'A held reply at revision zero.',
        provenanceToken: 'held-token',
        expiresAtEpochMillis: Date.now() + 60_000,
        concreteLanguageTag: 'en-Latn',
        baseReplyStateRevision: 0,
      },
    })
    h.finish()
    await background
    h.session.replyEdited()
    expect(h.session.getSnapshot()).toMatchObject({ result: null, visible: false })
    const explicit = h.session.request(options)
    expect(h.stream).toHaveBeenCalledTimes(2)
    const old = h.stream.mock.calls[1]!
    h.session.replyEdited()
    old[2]({
      sequence: 2,
      step: 'refused',
      reason: 'source_changed',
      retryAfterEpochMillis: null,
    })
    expect(await explicit).toBeNull()
    expect(h.session.getSnapshot()).toMatchObject({
      result: null,
      visible: false,
      running: false,
    })
    void h.session.request(options)
    expect(h.stream).toHaveBeenCalledTimes(3)
    h.session.dispose()
  })
  it('marks slow after ten seconds and Stop cancels only delivery with no new call', async () => {
    vi.useFakeTimers()
    const h = harness()
    const result = h.session.request(options)
    vi.advanceTimersByTime(9_999)
    expect(h.session.getSnapshot().slow).toBe(false)
    vi.advanceTimersByTime(1)
    expect(h.session.getSnapshot().slow).toBe(true)
    h.session.stop()
    h.event({ sequence: 1, step: 'done', result: fallback })
    expect(await result).toBeNull()
    expect(h.stream.mock.calls[0]![1].aborted).toBe(true)
    expect(h.stream).toHaveBeenCalledOnce()
    expect(h.session.getSnapshot()).toMatchObject({
      visible: false,
      running: false,
      result: null,
    })
  })
  it('gives a later explicit request a fresh key after Stop, without restarting on Stop itself', async () => {
    const h = harness()
    const old = h.session.request(options)
    const key = h.stream.mock.calls[0]![0].idempotencyKey
    h.session.stop()
    await old
    expect(h.stream).toHaveBeenCalledOnce()
    void h.session.request(options)
    expect(h.stream.mock.calls[1]![0].idempotencyKey).not.toBe(key)
    h.session.dispose()
  })
  it('changes tone, language and variation using fresh keys and fences retired events', async () => {
    const h = harness()
    void h.session.request(options)
    const old = h.stream.mock.calls[0]!
    void h.session.request({ ...options, tone: 'friendly', trigger: 'tone' })
    expect(old[1].aborted).toBe(true)
    old[2]({ sequence: 9, step: 'answering', sentenceNumbers: [99] })
    expect(h.session.getSnapshot().sentences).toEqual([])
    void h.session.request({ ...options, targetLanguage: { kind: 'review_language' } })
    void h.session.request({ ...options, trigger: 'try_again' })
    expect(h.stream.mock.calls.map(([request]) => request.variation)).toEqual([
      0, 0, 0, 1,
    ])
    expect(
      new Set(h.stream.mock.calls.map(([request]) => request.idempotencyKey)).size,
    ).toBe(4)
    h.session.dispose()
  })
  it('retries a deferred background admission explicitly without surfacing its error', async () => {
    const h = harness()
    const hidden = h.session.request(options, true)
    h.event({ sequence: 1, step: 'deferred', retryAfterEpochMillis: null })
    h.finish()
    await hidden
    expect(h.session.getSnapshot()).toMatchObject({ visible: false, result: null })
    void h.session.request(options)
    expect(h.stream).toHaveBeenCalledTimes(2)
    expect(h.stream.mock.calls[1]![0].intent).toBe('explicit')
    h.session.dispose()
  })
  it('generates for a deliberate same-tone action, but joins repeated running clicks and ordinary reveal', async () => {
    const h = harness()
    const first = h.session.request(options)
    h.event({ sequence: 1, step: 'done', result: fallback })
    h.finish()
    await first
    const tone = { ...options, trigger: 'tone' as const }
    const next = h.session.request(tone)
    expect(h.stream).toHaveBeenCalledTimes(2)
    expect(h.session.request(tone)).toBe(next)
    expect(h.session.request(options)).toBe(next)
    h.event({ sequence: 1, step: 'done', result: fallback })
    h.finish()
    await next
    void h.session.request(tone)
    expect(h.stream).toHaveBeenCalledTimes(3)
    h.session.dispose()
  })
  it('retains key, variation and Shorter options when busy is retried', async () => {
    const h = harness()
    const short = {
      ...options,
      trigger: 'try_again' as const,
      length: 'short' as const,
      maxWords: 20,
    }
    const first = h.session.request(short)
    h.event({
      sequence: 1,
      step: 'refused',
      reason: 'busy',
      retryAfterEpochMillis: Date.now() + 1000,
    })
    h.finish()
    await first
    void h.session.request(short)
    expect(h.stream.mock.calls[1]![0]).toEqual(h.stream.mock.calls[0]![0])
    h.session.dispose()
  })
})
