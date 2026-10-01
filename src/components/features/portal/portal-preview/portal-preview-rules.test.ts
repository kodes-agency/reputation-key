import { describe, expect, it } from 'vitest'
import {
  describeUnavailable,
  packFallbackNotice,
  TILE_PLACEHOLDER_NOTE,
  TRY_AS_GUEST_NOTICE,
} from './portal-preview-rules'

describe('describeUnavailable', () => {
  it('tells a manager nothing is live when no version was published', () => {
    expect(describeUnavailable('not_published').title).toBe('Nothing is live yet')
  })

  it('explains that an earlier-design version has no matching preview, and that publishing now writes the new design', () => {
    const note = describeUnavailable('earlier_design')

    expect(note.title).toContain('earlier design')
    expect(note.body).toContain('before the new design')
    expect(note.body).toContain('does not draw it')
    expect(note.body).toContain('publishing writes now')
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

describe('TILE_PLACEHOLDER_NOTE', () => {
  it('tells a request awaiting an admin from an address that is not approved at all', () => {
    expect(TILE_PLACEHOLDER_NOTE.awaiting_approval).toBe('Waiting for approval')
    expect(TILE_PLACEHOLDER_NOTE.not_approved).toContain('Not approved')
    expect(TILE_PLACEHOLDER_NOTE.not_approved).not.toContain('Waiting')
  })
})

describe('packFallbackNotice', () => {
  it('names the language whose wording is missing and what is drawn instead', () => {
    const notice = packFallbackNotice('German')

    expect(notice).toContain('German')
    expect(notice).toContain('shown in English')
  })
})
