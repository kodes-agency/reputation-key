import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { guestVoiceDetailSearch } from './-guest-voice-search'
import { guestVoiceDetailTarget, guestVoiceDetailParams } from './-guest-voice-details'
const schema = z.object(guestVoiceDetailSearch)
const id = '10000000-0000-4000-8000-000000000001'
describe('tolerant detail addresses', () => {
  it('drops invalid tokens and incomplete pairs before requesting anything', () => {
    expect(
      guestVoiceDetailTarget(
        schema.parse({ issue: 'bad', sense: 'praise', topic: 'invented' }),
      ),
    ).toBeNull()
    expect(guestVoiceDetailTarget(schema.parse({ issue: id }))).toBeNull()
    expect(
      guestVoiceDetailTarget(schema.parse({ concern: 'other', reason: 'not-a-reason' })),
    ).toBeNull()
    expect(
      guestVoiceDetailTarget(schema.parse({ topic: 3, sense: 'x'.repeat(100) })),
    ).toBeNull()
  })
  it('chooses concern, then issue, then topic and clears every competing token', () => {
    const target = guestVoiceDetailTarget(
      schema.parse({
        issue: id,
        sense: 'praise',
        concern: 'other',
        reason: 'health',
        topic: 'safety',
      }),
    )
    expect(target).toEqual({ kind: 'concern', issueId: null, reason: 'health' })
    expect(guestVoiceDetailParams(target)).toEqual({
      issue: undefined,
      sense: undefined,
      concern: 'other',
      reason: 'health',
      topic: undefined,
    })
    expect(
      guestVoiceDetailTarget(
        schema.parse({ issue: id, sense: 'praise', topic: 'safety' }),
      ),
    ).toEqual({ kind: 'issue', issueId: id, sense: 'praise' })
    expect(guestVoiceDetailTarget(schema.parse({ topic: 'safety' }))).toEqual({
      kind: 'topic',
      topic: 'safety',
    })
    expect(
      Object.values(guestVoiceDetailParams(null)).every((value) => value === undefined),
    ).toBe(true)
  })
})
