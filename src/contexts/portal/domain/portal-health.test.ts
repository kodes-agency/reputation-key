import { describe, expect, it } from 'vitest'
import { derivePortalHealth } from './portal-health'

const ready = {
  publicationState: 'published',
  propertyAvailable: true,
  hasActivePublicationSnapshot: true,
  hasResolvablePublicAddress: true,
  hasResponsibleManager: true,
  googleDestinationState: 'verified',
} as const

describe('derived Portal Health', () => {
  it('is Healthy only when the complete published gateway is ready', () => {
    expect(derivePortalHealth(ready)).toEqual({
      status: 'healthy',
      reason: 'operational',
    })
  })

  it('keeps private rating available in Degraded Google and responsibility states', () => {
    expect(
      derivePortalHealth({ ...ready, googleDestinationState: 'awaiting_refresh' }),
    ).toEqual({
      status: 'degraded',
      reason: 'google_destination_awaiting_refresh',
    })
    expect(derivePortalHealth({ ...ready, hasResponsibleManager: false })).toEqual({
      status: 'degraded',
      reason: 'responsibility_needed',
    })
  })

  it.each([
    ['draft', 'publication_draft'],
    ['disabled', 'publication_disabled'],
    ['archived', 'publication_archived'],
  ] as const)('marks %s publication as Unavailable', (publicationState, reason) => {
    expect(derivePortalHealth({ ...ready, publicationState })).toEqual({
      status: 'unavailable',
      reason,
    })
  })

  it('never lets health recovery override manager publication state', () => {
    expect(
      derivePortalHealth({
        ...ready,
        publicationState: 'disabled',
        googleDestinationState: 'verified',
      }),
    ).toEqual({ status: 'unavailable', reason: 'publication_disabled' })
  })
})
