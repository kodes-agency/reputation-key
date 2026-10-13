import { describe, expect, it } from 'vitest'
import type { z } from 'zod/v4'
import { Route } from './progress'

const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'

/** The route's search schema, as the router calls it. */
const search = Route.options.validateSearch as z.ZodType<{ propertyId?: string }>

describe('Progress path (retained for old links)', () => {
  it('reads the property an old link named', () => {
    expect(search.parse({ propertyId: PROPERTY_ID })).toEqual({ propertyId: PROPERTY_ID })
  })

  // An address this route cannot read is still an old link: it goes on to the
  // redirect (the properties list), not to the error page.
  it('drops a property id it cannot read instead of failing the page', () => {
    expect(search.parse({ propertyId: 'abc' })).toEqual({})
    expect(search.parse({ propertyId: 42 })).toEqual({})
  })

  it('sends a link with no readable property to the properties list', () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('The progress route must define beforeLoad')

    let thrown: unknown
    try {
      beforeLoad({
        context: { role: 'AccountAdmin' },
        search: search.parse({ propertyId: 'abc' }),
      } as never)
    } catch (redirected) {
      thrown = redirected
    }

    expect(thrown).toMatchObject({ options: { to: '/properties' } })
  })
})
