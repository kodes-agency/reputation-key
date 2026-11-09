import { describe, expect, it } from 'vitest'
import { feedbackSetupTarget } from './inbox-feedback-setup'

const HARBOR = { id: '60000000-0000-4000-8000-000000000001' }
const GARDEN = { id: '60000000-0000-4000-8000-000000000002' }

describe('feedbackSetupTarget', () => {
  it('sets a page up for the Property the Inbox is scoped to', () => {
    expect(feedbackSetupTarget(HARBOR.id, [HARBOR, GARDEN])).toEqual({
      propertyId: HARBOR.id,
    })
  })

  it('sets a page up for the only Property there is when no Property is chosen', () => {
    expect(feedbackSetupTarget(undefined, [GARDEN])).toEqual({ propertyId: GARDEN.id })
  })

  it('leaves the choice to the Portals page when several Properties could be meant', () => {
    expect(feedbackSetupTarget(undefined, [HARBOR, GARDEN])).toEqual({
      propertyId: null,
    })
    expect(feedbackSetupTarget(undefined, [])).toEqual({ propertyId: null })
  })
})
