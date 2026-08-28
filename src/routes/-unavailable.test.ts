import { describe, expect, it } from 'vitest'
import { unavailablePageContent } from './unavailable'

describe('unavailable route presentation', () => {
  it('gives an account without a workspace a recovery path instead of beta-disable copy', () => {
    expect(unavailablePageContent({ reason: 'workspace_access' })).toEqual({
      title: "Workspace access isn't ready",
      description:
        'Your account is signed in, but it is not connected to an active workspace.',
      guidance:
        'Review any pending invitation. If none is available, ask the person who invited you to confirm your access.',
      link: {
        label: 'Review pending invitations',
        to: '/accept-invitation',
      },
    })
  })

  it('keeps stale dormant-feature links on the mild beta explanation', () => {
    expect(unavailablePageContent({ feature: 'Recognition' })).toEqual({
      title: 'Recognition is not available in this beta',
      description: 'Recognition is not part of the current beta experience.',
      guidance: null,
      link: { label: 'Back to home', to: '/home' },
    })
  })
})
