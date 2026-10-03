// The full-bleed decision is a string match on a path, and two layout routes ask
// it (the authenticated shell and the Property layout). One predicate answers
// for both, so a new full-bleed surface is added in one place: a wrong answer
// either squeezes a workspace into the padded page shell or strips the padding
// off a page that needs it.

import { describe, expect, it } from 'vitest'
import { isFullBleedRoute } from './full-bleed-route'

const PROPERTY = '0b6f8a52-4c2e-4d61-9a55-2f1d3c7e9b10'
const PORTAL = '7c1e5a90-3b44-4f0d-8e21-6a9d0b2c4f33'

describe('isFullBleedRoute', () => {
  it.each([
    '/inbox',
    '/inbox/',
    '/inbox/some-segment',
    `/properties/${PROPERTY}/reviews`,
    `/properties/${PROPERTY}/reviews/`,
    `/properties/${PROPERTY}/portals/${PORTAL}`,
    `/properties/${PROPERTY}/portals/${PORTAL}/review`,
  ])('is full-bleed: %s', (pathname) => {
    expect(isFullBleedRoute(pathname)).toBe(true)
  })

  it.each([
    '/',
    '/properties',
    '/portals',
    '/notifications',
    '/settings/profile',
    `/properties/${PROPERTY}`,
    `/properties/${PROPERTY}/google`,
    `/properties/${PROPERTY}/people`,
    `/properties/${PROPERTY}/goals`,
    `/properties/${PROPERTY}/settings/profile`,
    // The portals list, the New portal form, the Property look and the group
    // pages stay in the padded page shell.
    `/properties/${PROPERTY}/portals`,
    `/properties/${PROPERTY}/portals/new`,
    `/properties/${PROPERTY}/portals/look`,
    `/properties/${PROPERTY}/portals/groups/${PORTAL}`,
    '/properties/import-google',
  ])('is padded: %s', (pathname) => {
    expect(isFullBleedRoute(pathname)).toBe(false)
  })

  it('does not take a path that only mentions a full-bleed word for a full-bleed route', () => {
    expect(isFullBleedRoute('/inboxes')).toBe(false)
    expect(isFullBleedRoute('/settings/inbox')).toBe(false)
    expect(isFullBleedRoute(`/properties/${PROPERTY}/goals/reviews`)).toBe(false)
    expect(isFullBleedRoute(`/properties/${PROPERTY}/reviews-summary`)).toBe(false)
  })

  it('reads an undefined pathname as padded', () => {
    // beforeLoad can run against router state that has not parsed a path yet.
    expect(isFullBleedRoute(undefined)).toBe(false)
  })
})
