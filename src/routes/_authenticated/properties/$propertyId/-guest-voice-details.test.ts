import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { guestVoiceDetailSearch } from './-guest-voice-search'
import { guestVoiceDetailTarget, guestVoiceDetailParams } from './-guest-voice-details'
const schema = z.object(guestVoiceDetailSearch)
const id = '10000000-0000-4000-8000-000000000001'
describe('tolerant single-token detail addresses', () => {
  it.each([
    3,
    'x'.repeat(65),
    'issue:bad:praise',
    `issue:${id}`,
    'topic:invented',
    'concern:other:not-a-reason',
    'topic:safety:extra',
    `issue:${id}:praise:extra`,
  ])('drops an invalid target %s', (detail) => {
    expect(guestVoiceDetailTarget(schema.parse({ detail }))).toBeNull()
  })
  it('round-trips complete targets with full sense/reason identity', () => {
    for (const target of [
      { kind: 'issue', issueId: id, sense: 'praise' },
      { kind: 'concern', issueId: null, reason: 'health' },
      { kind: 'topic', topic: 'safety' },
    ] as const) {
      expect(
        guestVoiceDetailTarget(schema.parse(guestVoiceDetailParams(target))),
      ).toEqual(target)
    }
    expect(guestVoiceDetailParams(null)).toEqual({ detail: undefined })
  })
})
