import { describe, expect, it } from 'vitest'
import type { z } from 'zod/v4'
import type { Role } from '#/shared/domain/roles'
import { Route } from './progress'

const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'

/** The route's search schema, as the router calls it. */
const search = Route.options.validateSearch as z.ZodType<{ propertyId?: string }>

function open(role: Role, propertyId?: unknown): unknown {
  const beforeLoad = Route.options.beforeLoad
  if (!beforeLoad) throw new Error('The progress route must define beforeLoad')
  try {
    beforeLoad({ context: { role }, search: search.parse({ propertyId }) } as never)
  } catch (result) {
    return result
  }
  throw new Error('The progress route must redirect or explain why it is unavailable')
}

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

  it.each(['AccountAdmin', 'PropertyManager'] as const)(
    'keeps a valid old link pointed at its Property goals for %s',
    (role) => {
      expect(open(role, PROPERTY_ID)).toMatchObject({
        options: {
          to: '/properties/$propertyId/goals',
          params: { propertyId: PROPERTY_ID },
        },
      })
    },
  )

  it('explains a role refusal inside the shell with a way back', () => {
    expect(open('Member', PROPERTY_ID)).toMatchObject({
      isNotFound: true,
      routeId: '/_authenticated',
      data: { cause: 'role', title: 'Goals', back: 'properties' },
    })
  })

  it.each([undefined, 'abc', 42])(
    'keeps the Properties fallback for an unreadable old link (%s), even without goal access',
    (propertyId) => {
      expect(open('Member', propertyId)).toMatchObject({
        options: { to: '/properties' },
      })
    },
  )
})
