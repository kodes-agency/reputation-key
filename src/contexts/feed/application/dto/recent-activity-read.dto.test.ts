// The Recent Activity reads' page bounds, at the HTTP boundary.
//
// A fractional or astronomically large limit/offset used to pass validation
// and fail later, in PostgreSQL's bigint parse of LIMIT/OFFSET, as a masked
// 500 plus an untagged error log. It must be a 400 instead: refused here.

import { describe, expect, it } from 'vitest'
import {
  activityTimelineReadDto,
  recentActivityListDto,
} from './recent-activity-read.dto'

const TIMELINE = { resourceType: 'inbox_item', resourceId: 'item-1' } as const

describe('Recent Activity read bounds', () => {
  it('refuses a fractional or unbounded page size or offset for the recent list', () => {
    for (const malformed of [
      { limit: 1.5 },
      { limit: '1.5' },
      { limit: '1e21' },
      { offset: 0.5 },
      { offset: '1e21' },
      { offset: -1 },
    ]) {
      expect(recentActivityListDto.safeParse(malformed).success).toBe(false)
    }
  })

  it('still accepts whole-number pages of the recent list as query strings', () => {
    expect(recentActivityListDto.parse({ limit: '25', offset: '50' })).toEqual({
      limit: 25,
      offset: 50,
    })
    expect(recentActivityListDto.parse({})).toEqual({ limit: 50, offset: 0 })
  })

  it('refuses a fractional timeline page size', () => {
    for (const limit of [1.5, '1.5', '1e21']) {
      expect(activityTimelineReadDto.safeParse({ ...TIMELINE, limit }).success).toBe(
        false,
      )
    }
    expect(activityTimelineReadDto.parse({ ...TIMELINE, limit: '10' })).toEqual({
      ...TIMELINE,
      limit: 10,
    })
  })
})
