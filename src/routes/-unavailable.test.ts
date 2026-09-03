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

  it('explains a capability that is not part of the beta', () => {
    expect(
      unavailablePageContent({
        feature: 'Recognition',
        category: 'not_in_beta',
        propertyId: 'property-1',
      }),
    ).toEqual({
      title: 'Recognition is not part of this beta',
      description:
        'This capability is switched off for the closed beta and cannot be enabled from Settings.',
      guidance: null,
      link: { label: 'Back to dashboard', to: '/dashboard' },
    })
  })

  it('links admin-enablement refusals to the selected property settings', () => {
    expect(
      unavailablePageContent({
        feature: 'Goals',
        category: 'needs_admin_enablement',
        propertyId: 'property-1',
      }),
    ).toEqual({
      title: 'Goals is not enabled for this workspace',
      description:
        'An account admin can enable it for this property from Property settings.',
      guidance: null,
      link: {
        label: 'Open property settings',
        to: '/properties/$propertyId/settings',
        params: { propertyId: 'property-1' },
      },
    })
  })

  it('falls back to the dashboard when admin enablement has no property target', () => {
    expect(
      unavailablePageContent({
        feature: 'Goals',
        category: 'needs_admin_enablement',
      }),
    ).toEqual({
      title: 'Goals is not enabled for this workspace',
      description:
        'An account admin can enable it for this property from Property settings.',
      guidance: null,
      link: { label: 'Back to dashboard', to: '/dashboard' },
    })
  })

  it('explains a temporarily unavailable capability without linking to settings', () => {
    expect(
      unavailablePageContent({
        feature: 'Portals',
        category: 'temporarily_unavailable',
        propertyId: 'property-1',
      }),
    ).toEqual({
      title: 'Portals is temporarily unavailable',
      description:
        'Access is paused for this workspace or property. Try again later or contact support.',
      guidance: null,
      link: { label: 'Back to dashboard', to: '/dashboard' },
    })
  })

  it('keeps uncategorized dormant-feature links on the generic beta explanation', () => {
    expect(unavailablePageContent({ feature: 'Recognition' })).toEqual({
      title: 'Recognition is not available in this beta',
      description: 'Recognition is not part of the current beta experience.',
      guidance: null,
      link: { label: 'Back to dashboard', to: '/dashboard' },
    })
  })
})
