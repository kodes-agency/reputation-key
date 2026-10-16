import { afterEach, describe, expect, it } from 'vitest'
import { browserRouteTemplate, setBrowserRouteSource } from './browser-route'

describe('browserRouteTemplate', () => {
  afterEach(() => setBrowserRouteSource(undefined))

  it('is unknown until the router registers itself', () => {
    expect(browserRouteTemplate()).toBeUndefined()
  })

  it.each(['__root__', '/', '/_authenticated/properties/$propertyId/goals/$goalId'])(
    'reads the route template %s',
    (template) => {
      setBrowserRouteSource(() => template)
      expect(browserRouteTemplate()).toBe(template)
    },
  )

  it.each([
    ['an address with a query', '/inbox?review=guest@example.invalid'],
    ['a relative path', 'inbox'],
    ['a path with spaces', '/a b'],
  ])('refuses %s', (_label, value) => {
    setBrowserRouteSource(() => value)
    expect(browserRouteTemplate()).toBeUndefined()
  })

  it('stays unknown when the router throws', () => {
    setBrowserRouteSource(() => {
      throw new Error('router state unavailable')
    })
    expect(browserRouteTemplate()).toBeUndefined()
  })
})
