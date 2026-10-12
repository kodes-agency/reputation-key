import { describe, expect, it } from 'vitest'
import { peopleSearchSchema } from './people-search-schema'

describe('peopleSearchSchema', () => {
  it('accepts a bare Staff URL', () => {
    expect(peopleSearchSchema.parse({})).toEqual({})
  })

  it.each(['staff', 'directory', 'anything-else'])(
    'accepts and drops an old ?tab=%s link instead of failing the route',
    (tab) => {
      expect(peopleSearchSchema.parse({ tab })).toEqual({})
    },
  )
})
