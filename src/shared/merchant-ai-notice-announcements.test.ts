import { describe, expect, it } from 'vitest'
import { CURRENT_MERCHANT_AI_NOTICE } from './merchant-ai-notice-contract'
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from './merchant-ai-notice-announcements'

describe('merchant AI update announcements', () => {
  it('always has plain-language announcement copy for the served notice', () => {
    const announcement =
      MERCHANT_AI_NOTICE_ANNOUNCEMENTS[CURRENT_MERCHANT_AI_NOTICE.version]
    expect(announcement?.title).toBeTruthy()
    expect(announcement?.points.length).toBeGreaterThan(0)
    expect(announcement?.points.every((point) => point.trim().length > 0)).toBe(true)
  })
  it('states the switch-on changes, including the current provider and temporary recount', () => {
    const announcement =
      MERCHANT_AI_NOTICE_ANNOUNCEMENTS['merchant-ai-notice-2026-10-30.v1']!
    expect(announcement.title).toBe('AI review insights got an upgrade')
    expect(announcement.points).toHaveLength(4)
    expect(announcement.points.join(' ')).toContain('Today only OpenAI is used.')
    expect(announcement.points.join(' ')).toContain('Past reviews are read again')
  })
  it('states the drafting release, including drafts prepared when a review opens', () => {
    const announcement =
      MERCHANT_AI_NOTICE_ANNOUNCEMENTS['merchant-ai-notice-2026-11-01.v1']!
    expect(announcement.title).toBe('AI reply drafts got better')
    expect(announcement.points).toHaveLength(4)
    expect(announcement.points.join(' ')).toContain('as soon as you open a review')
    expect(announcement.points.join(' ')).toContain('press Stop')
  })
})
