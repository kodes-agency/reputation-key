import { describe, expect, it } from 'vitest'
import { LINK_APPROVAL_NAMES } from '../link-tree/linktree-approval-names'
import {
  APPROVED_DESTINATION_STATUS,
  HELD_BACK_EXPLANATION,
  describeWaitingSites,
} from './portal-approved-destination-status'

describe('the approval state of a site allowed for links', () => {
  it('reads as words a manager would say, never as the stored token', () => {
    for (const [state, presentation] of Object.entries(APPROVED_DESTINATION_STATUS)) {
      expect(presentation.label).not.toBe(state)
      expect(presentation.label).toMatch(/^[A-Z]/u)
    }
  })

  it.each([
    ['approved', 'Approved', 'positive'],
    ['pending', 'Waiting for approval', 'warn'],
    ['disabled', 'Turned off', 'neutral'],
    ['quarantined', 'Held back for safety', 'negative'],
  ] as const)('%s is "%s" in the %s tone', (state, label, tone) => {
    expect(APPROVED_DESTINATION_STATUS[state]).toEqual({ label, tone })
  })

  it('uses the same name for a state as the tile that opens the site', () => {
    for (const [state, presentation] of Object.entries(APPROVED_DESTINATION_STATUS)) {
      expect(presentation.label).toBe(
        LINK_APPROVAL_NAMES[state as keyof typeof LINK_APPROVAL_NAMES],
      )
    }
  })

  it('says why a held back site is not shown, and where to turn', () => {
    expect(HELD_BACK_EXPLANATION).toMatch(/safety checks/u)
    expect(HELD_BACK_EXPLANATION).toMatch(/support/u)
  })
})

describe('describeWaitingSites', () => {
  const site = (approvalState: 'approved' | 'pending' | 'disabled') => ({ approvalState })

  it('counts the sites waiting for an answer first', () => {
    expect(
      describeWaitingSites([site('approved'), site('pending'), site('pending')]),
    ).toBe('2 waiting for approval')
  })

  it('counts every site when none waits', () => {
    expect(describeWaitingSites([])).toBe('0 sites')
    expect(describeWaitingSites([site('approved')])).toBe('1 site')
    expect(describeWaitingSites([site('approved'), site('disabled')])).toBe('2 sites')
  })
})
