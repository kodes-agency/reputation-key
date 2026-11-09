import { describe, expect, it } from 'vitest'
import type { PortalGoalChangeSubmission } from './portal-goal-change-submission'
import { portalGoalChangeSend } from './portal-goal-change-draft'

const submission = { when: 'next' } as unknown as PortalGoalChangeSubmission

describe('portalGoalChangeSend', () => {
  it('sends the submission with its toast once both are ready', () => {
    expect(portalGoalChangeSend({ submission, toast: 'From Dec: 40' })).toEqual({
      submission,
      toast: 'From Dec: 40',
    })
  })

  it('sends nothing without a submission', () => {
    expect(portalGoalChangeSend({ submission: null, toast: 'From Dec: 40' })).toBeNull()
  })

  it('sends nothing without the words said after saving', () => {
    expect(portalGoalChangeSend({ submission, toast: null })).toBeNull()
  })
})
