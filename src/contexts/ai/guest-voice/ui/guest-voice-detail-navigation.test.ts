import { describe, expect, it } from 'vitest'
import {
  detailTargetKey,
  detailTrailFor,
  type DetailStep,
} from './guest-voice-detail-navigation'
describe('detail target identity and Back trail', () => {
  const issue = { kind: 'issue', issueId: 'a', sense: 'praise' } as const
  const topic = { kind: 'topic', topic: 'cleanliness' } as const
  const step: DetailStep = { target: issue, title: 'Team', scroll: 380, focus: 'cause:a' }
  it('separates polarity, concern reason and ungrouped concerns', () => {
    expect(detailTargetKey(issue)).not.toBe(
      detailTargetKey({ ...issue, sense: 'complaint' }),
    )
    expect(detailTargetKey({ kind: 'concern', issueId: null, reason: 'health' })).toBe(
      'concern:other:health',
    )
    expect(detailTargetKey(null)).toBe('closed')
  })
  it('replays a known URL target without inventing a step for a direct link', () => {
    expect(detailTrailFor([step], issue)).toEqual([])
    expect(detailTrailFor([step], topic)).toEqual([])
    expect(detailTrailFor([step, { ...step, target: topic }], topic)).toEqual([step])
    expect(step.scroll).toBe(380)
  })
})
