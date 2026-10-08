// The full-bleed decision is a string match on a path, and both layout routes
// make it: a wrong answer either squeezes the workspace into the padded page
// shell or strips the padding off the portals list and the New portal form.

import { describe, expect, it } from 'vitest'
import { isWorkspaceReviewRoute, isWorkspaceRoute } from './portal-workspace-route'

const PROPERTY = '0b6f8a52-4c2e-4d61-9a55-2f1d3c7e9b10'
const PORTAL = '7c1e5a90-3b44-4f0d-8e21-6a9d0b2c4f33'

describe('isWorkspaceRoute', () => {
  it.each([
    `/properties/${PROPERTY}/portals/${PORTAL}`,
    `/properties/${PROPERTY}/portals/${PORTAL}/`,
    `/properties/${PROPERTY}/portals/${PORTAL}/review`,
    `/properties/${PROPERTY}/portals/${PORTAL}/review/`,
  ])('is the workspace: %s', (pathname) => {
    expect(isWorkspaceRoute(pathname)).toBe(true)
  })

  it.each([
    '/',
    '/inbox',
    '/properties',
    `/properties/${PROPERTY}`,
    `/properties/${PROPERTY}/portals`,
    `/properties/${PROPERTY}/portals/`,
    `/properties/${PROPERTY}/portals/new`,
    // The Property look is a page of its own, in the padded shell.
    `/properties/${PROPERTY}/portals/look`,
    `/properties/${PROPERTY}/portals/look/`,
    `/properties/${PROPERTY}/goals/${PORTAL}`,
    `/properties/${PROPERTY}/reviews`,
    `/properties/${PROPERTY}/portals/${PORTAL}/unknown`,
    `/properties/${PROPERTY}/portals/${PORTAL}/review/extra`,
    `/settings/properties/${PROPERTY}/portals/${PORTAL}`,
  ])('is not the workspace: %s', (pathname) => {
    expect(isWorkspaceRoute(pathname)).toBe(false)
  })

  it('is not fooled by a portal path that only appears later in the URL', () => {
    expect(isWorkspaceRoute(`/inbox/properties/${PROPERTY}/portals/${PORTAL}`)).toBe(
      false,
    )
  })

  it('reads an undefined pathname as not the workspace', () => {
    // beforeLoad can run against router state that has not parsed a path yet.
    expect(isWorkspaceRoute(undefined)).toBe(false)
  })
})

describe('isWorkspaceReviewRoute', () => {
  it('is the review page, with or without a trailing slash', () => {
    expect(
      isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals/${PORTAL}/review`),
    ).toBe(true)
    expect(
      isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals/${PORTAL}/review/`),
    ).toBe(true)
  })

  it('is not the editor, the list or anything outside the workspace', () => {
    expect(isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals/${PORTAL}`)).toBe(
      false,
    )
    expect(isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals/new`)).toBe(false)
    expect(isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals/look`)).toBe(false)
    expect(isWorkspaceReviewRoute(`/properties/${PROPERTY}/portals`)).toBe(false)
    expect(isWorkspaceReviewRoute(`/properties/${PROPERTY}/reviews`)).toBe(false)
    expect(isWorkspaceReviewRoute(undefined)).toBe(false)
  })
})
