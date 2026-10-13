import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod/v4'

vi.mock('#/routes/-queries/route-queries', () => ({
  merchantAiOverviewQuery: {},
  organizationAiSpendQuery: {},
  reviewAnalysisProgressQuery: vi.fn(),
}))

import { Route } from './ai'

const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'

/** The route's search schema, as the router calls it. */
const search = Route.options.validateSearch as z.ZodType<{ propertyId?: string }>

describe('AI overview address', () => {
  it('reads the property an old link named, to send it on to that property', () => {
    expect(search.parse({ propertyId: PROPERTY_ID })).toEqual({ propertyId: PROPERTY_ID })
  })

  // An old link whose property id cannot be read still opens the overview.
  it('drops a property id it cannot read instead of failing the page', () => {
    expect(search.parse({ propertyId: 'abc' })).toEqual({})
    expect(search.parse({ propertyId: 42 })).toEqual({})
  })
})
