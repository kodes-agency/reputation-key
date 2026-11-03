import { expect, it } from 'vitest'
import { Route } from './people'
it('keeps the Staff route free of profile reads and mutations', () => {
  expect(Route.options.loader).toBeUndefined()
  expect(Route.options.staticData?.page?.title).toBe('Staff')
  expect(Route.options.validateSearch).toBeTypeOf('function')
})
