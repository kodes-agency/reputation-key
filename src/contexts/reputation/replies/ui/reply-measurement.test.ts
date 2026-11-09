import { replyBodyWords } from '#/shared/domain/reply-frame'
import { restoreSnapshot } from './reply-composer-transitions'
import { describe, expect, it } from 'vitest'
import { normalizedDraftEditDistance } from './reply-measurement'

describe('browser draft edit distance', () => {
  it('normalizes NFC and collapses whitespace before comparing Unicode characters', () => {
    expect(normalizedDraftEditDistance('  Cafe\u0301\n\t😊 ', 'Café 😊')).toBe(0)
    expect(normalizedDraftEditDistance('😊a', '😊b')).toBe(0.5)
  })
  it('uses the longer character length and stays bounded for empty and changed text', () => {
    expect(normalizedDraftEditDistance('', '')).toBe(0)
    expect(normalizedDraftEditDistance('', 'abc')).toBe(1)
    expect(normalizedDraftEditDistance('abc', 'xyz')).toBe(1)
    expect(normalizedDraftEditDistance('kitten', 'sitting')).toBeCloseTo(3 / 7)
    expect(normalizedDraftEditDistance('ab', 'abc')).toBeCloseTo(1 / 3)
  })
})

import {
  createDraftMeasurementSession,
  draftEditMetric,
  measuredDraftSnapshot,
} from './reply-measurement'
import type { DraftMeasurementEvent } from '#/shared/domain/draft-measurement'

const ready = (generationId: string) => ({
  status: 'ready' as const,
  profileVersion: 'reply-draft-v3' as const,
  replyText: 'PRIVATE BASELINE',
  provenanceToken: 'PRIVATE TOKEN',
  expiresAtEpochMillis: 100,
  baseReplyStateRevision: 5,
  concreteLanguageTag: 'en-Latn-US',
  measurementGenerationId: generationId,
})

describe('compose-session measurement ownership', () => {
  it('attributes buttons without superseding previously adopted generations', () => {
    const events: DraftMeasurementEvent[] = []
    const session = createDraftMeasurementSession((event) => events.push(event))
    expect(session.request('professional')).toBe('draft')
    session.show(ready('A'))
    session.adopt()
    expect(session.request('friendly')).toBe('tone')
    session.show(ready('B'))
    session.adopt()
    expect(events).toEqual([
      { generationId: 'A', baseReplyRevision: 5, event: 'shown' },
      { generationId: 'A', baseReplyRevision: 5, event: 'draft' },
      { generationId: 'B', baseReplyRevision: 5, event: 'shown' },
      { generationId: 'B', baseReplyRevision: 5, event: 'tone' },
    ])
    expect(JSON.stringify(events)).not.toContain('PRIVATE')
  })
  it('keeps a preview current after a refused regeneration, and distinguishes dismissal from navigation', () => {
    const events: DraftMeasurementEvent[] = []
    const session = createDraftMeasurementSession((event) => events.push(event))
    session.request('professional')
    session.show(ready('A'))
    session.request('professional')
    expect(events.some((event) => event.event === 'superseded')).toBe(false)
    session.dismiss(true)
    session.show(ready('B'))
    session.leave()
    expect(
      events
        .filter((event) => event.event === 'dismissed')
        .map((event) => event.generationId),
    ).toEqual(['A'])
    expect(
      events
        .filter((event) => event.event === 'superseded')
        .map((event) => event.generationId),
    ).toEqual(['B'])
  })
  it('preserves reloaded identity but reports unavailable without its ephemeral baseline', () => {
    const session = createDraftMeasurementSession(undefined, 'saved-generation', 3)
    expect(session.request('professional')).toBe('try_again')
    expect(
      draftEditMetric({
        text: 'Edited after reload',
        languageTag: 'en-Latn-US',
        measurementGenerationId: 'saved-generation',
      }),
    ).toEqual({ generationId: 'saved-generation', distance: null })
    const adopted = measuredDraftSnapshot(ready('A'), {
      text: 'PRIVATE BASELINE',
      languageTag: 'en-Latn-US',
    })
    expect(draftEditMetric(adopted)).toEqual({ generationId: 'A', distance: 0 })
    expect(draftEditMetric({ ...adopted, text: 'Changed' })?.distance).toBeGreaterThan(0)
    expect(draftEditMetric({ text: 'typed', languageTag: null })).toBeUndefined()
  })
})

it('does not treat a StrictMode effect replay as navigation', async () => {
  const events: DraftMeasurementEvent[] = []
  const session = createDraftMeasurementSession((event) => events.push(event), 'saved', 1)
  session.show(ready('preview'))
  events.length = 0
  const first = session.attach()
  first()
  const replay = session.attach()
  await Promise.resolve()
  expect(events).toEqual([])
  replay()
  await Promise.resolve()
  expect(events).toEqual([
    { generationId: 'preview', baseReplyRevision: 5, event: 'superseded' },
  ])
})

it('records a finished draft retired by navigation without claiming it was shown', () => {
  const events: DraftMeasurementEvent[] = []
  const session = createDraftMeasurementSession((event) => events.push(event))
  session.discard(ready('late-draft'))
  expect(events).toEqual([
    { generationId: 'late-draft', baseReplyRevision: 5, event: 'superseded' },
  ])
})

it('never supersedes an adopted draft on leave, replacement, restore or late completion', async () => {
  const events: DraftMeasurementEvent[] = []
  const session = createDraftMeasurementSession((event) => events.push(event))
  session.show(ready('adopted'))
  session.adopt()
  session.leave()
  session.show(ready('replacement'))
  session.adopt()
  session.restore({
    text: 'restored',
    languageTag: null,
    measurementGenerationId: 'adopted',
  })
  session.discard(ready('adopted'))
  const detach = session.attach()
  detach()
  await Promise.resolve()
  expect(events.filter((event) => event.event === 'superseded')).toEqual([])
})

it('keeps the adopted body frame independent from the next preview and restores it with Undo', () => {
  const frameA = {
    prefix: 'Hello Anna,',
    suffix: 'Contact our team. Kind regards, Management',
  }
  const frameB = {
    prefix: 'Dear Anna,',
    suffix: 'We hope to see you again. Yours sincerely, Team',
  }
  const body = 'One two three four five six seven eight.'
  const text = `${frameA.prefix}\n\n${body}\n\n${frameA.suffix}`
  const adopted = measuredDraftSnapshot(
    { ...ready('a'), localFrame: frameA },
    { text, languageTag: 'en-Latn' },
  )
  const preview = measuredDraftSnapshot(
    { ...ready('b'), localFrame: frameB },
    { text: 'A different proposed reply.', languageTag: 'en-Latn' },
  )
  expect(replyBodyWords(adopted.text, adopted.bodyFrame ?? null)).toBe(8)
  expect(preview.bodyFrame).toEqual(frameB)
  const restored = restoreSnapshot(
    {
      draft: adopted,
      adoption: { kind: 'personalized', languageTag: 'en-Latn', template: null },
      hasAiDraft: true,
    },
    { detectedReviewLanguage: 'en-Latn', reviewLanguageReadiness: 'detectable' },
  )
  expect(restored.snapshot.draft.bodyFrame).toEqual(frameA)
  expect(
    replyBodyWords(
      restored.snapshot.draft.text,
      restored.snapshot.draft.bodyFrame ?? null,
    ),
  ).toBe(8)
})
