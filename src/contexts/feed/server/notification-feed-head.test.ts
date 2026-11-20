import { describe, expect, it } from 'vitest'
import { getNotificationFeedHeadDto, getNotificationsDto } from './notifications'

describe('notification feed-head server contract', () => {
  it('accepts only a first-page head request and applies bounded defaults', () => {
    expect(getNotificationFeedHeadDto.parse({})).toEqual({
      limit: 20,
      filter: 'all',
    })
    expect(
      getNotificationFeedHeadDto.safeParse({ limit: 101, filter: 'all' }).success,
    ).toBe(false)
    expect(
      getNotificationFeedHeadDto.safeParse({ limit: 20, filter: 'unknown' }).success,
    ).toBe(false)
  })

  it('refuses a fractional or unbounded page size at the boundary', () => {
    for (const limit of [1.5, '1.5', '1e21', 0, -1]) {
      expect(getNotificationFeedHeadDto.safeParse({ limit }).success).toBe(false)
    }
    expect(getNotificationFeedHeadDto.parse({ limit: '50' })).toEqual({
      limit: 50,
      filter: 'all',
    })
  })

  it('continues history only from a server-minted keyset cursor, never an offset', () => {
    const before = {
      at: '2026-09-01T12:00:00.123456Z',
      id: '10000000-0000-4000-8000-000000000001',
    }
    expect(getNotificationsDto.parse({ before })).toEqual({
      limit: 20,
      filter: 'all',
      before,
    })
    expect(getNotificationsDto.parse({ offset: 40 })).not.toHaveProperty('offset')
    for (const malformed of [
      { ...before, at: '1e21' },
      { ...before, at: '2026-09-01T12:00:00+02:00' },
      { ...before, id: 'not-a-uuid' },
    ]) {
      expect(getNotificationsDto.safeParse({ before: malformed }).success).toBe(false)
    }
  })
})
