import { describe, expect, it } from 'vitest'
import { matchedTopicOf } from './use-matched-topic'

describe('matchedTopicOf', () => {
  it('reads the topic and the polarity a Guest voice link names', () => {
    expect(matchedTopicOf({ aspect: 'room', polarity: 'negative' })).toEqual({
      aspect: 'room',
      polarity: 'negative',
    })
  })

  it('reads a topic with no polarity', () => {
    expect(matchedTopicOf({ aspect: 'wait_time' })).toEqual({
      aspect: 'wait_time',
      polarity: undefined,
    })
  })

  it('is no topic for an address without one, whatever else it holds', () => {
    expect(matchedTopicOf({ polarity: 'negative' })).toBeNull()
    expect(matchedTopicOf({ queue: 'reply', since: '2026-06-13' })).toBeNull()
    expect(matchedTopicOf({})).toBeNull()
  })

  it('is no topic for a value the Inbox does not read, and keeps a polarity it does', () => {
    expect(matchedTopicOf({ aspect: 'parking_valet', polarity: 'negative' })).toBeNull()
    expect(matchedTopicOf({ aspect: 'room', polarity: 'angry' })).toEqual({
      aspect: 'room',
      polarity: undefined,
    })
  })

  it('is no topic for no address at all', () => {
    expect(matchedTopicOf(undefined)).toBeNull()
    expect(matchedTopicOf(null)).toBeNull()
  })
})
