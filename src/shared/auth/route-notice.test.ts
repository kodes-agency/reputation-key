// A page the signed-in person cannot use answers inside the app shell instead of
// a silent redirect or a page on the public chrome. The answer travels as the
// `data` of a router `notFound()`, so it keeps the document's 404 and survives
// server rendering. These tests pin what a thrown notice carries; the sentences
// it becomes are `route-notice-copy`'s.
import { describe, expect, it } from 'vitest'
import { isNotFound } from '@tanstack/react-router'
import { PROPERTY_NOT_FOUND, roleUnavailable, routeNotice } from './route-notice'

describe('routeNotice', () => {
  it('is a router not-found aimed at the app shell, so no nearer page swallows it', () => {
    const thrown = routeNotice(PROPERTY_NOT_FOUND)
    expect(isNotFound(thrown)).toBe(true)
    expect(thrown).toMatchObject({ routeId: '/_authenticated', data: PROPERTY_NOT_FOUND })
  })
})

describe('roleUnavailable', () => {
  it('carries the page, and where to go instead', () => {
    const thrown = roleUnavailable('People', 'properties')
    expect(isNotFound(thrown)).toBe(true)
    expect(thrown).toMatchObject({
      routeId: '/_authenticated',
      data: { cause: 'role', title: 'People', back: 'properties' },
    })
  })

  it('names a subject only when it is given one', () => {
    const plain = roleUnavailable('People', 'properties') as { data: object }
    expect(plain.data).not.toHaveProperty('subject')
    const named = roleUnavailable(
      'New Goal',
      { to: '/g', label: 'Back to goals' },
      'this page',
    )
    expect(named).toMatchObject({
      data: { subject: 'this page', back: { to: '/g', label: 'Back to goals' } },
    })
  })
})
