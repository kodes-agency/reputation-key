import { describe, expect, it } from 'vitest'
import { describeUnavailable, TRY_AS_GUEST_NOTICE } from './portal-preview-rules'

describe('describeUnavailable', () => {
  it('tells a manager nothing is live when no version was published', () => {
    expect(describeUnavailable('not_published').title).toBe('Nothing is live yet')
  })

  it('explains that an earlier-design version has no matching preview, and what to do', () => {
    const note = describeUnavailable('earlier_design')

    expect(note.title).toContain('earlier design')
    expect(note.body).toContain('Publishing again')
  })

  it('points back to the draft when the live version cannot be drawn', () => {
    expect(describeUnavailable('incomplete').body).toContain('draft preview still works')
  })
})

describe('TRY_AS_GUEST_NOTICE', () => {
  it('promises that nothing is written', () => {
    expect(TRY_AS_GUEST_NOTICE).toContain('Nothing is saved or counted')
  })
})
