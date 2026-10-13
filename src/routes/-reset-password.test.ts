import { describe, expect, it } from 'vitest'
import type { z } from 'zod/v4'
import { Route } from './reset-password'

const TOKEN = 'Zk3vQ9d1LmX0aB7cR2tY5uWe'

/** The route's search schema, as the router calls it. */
const search = Route.options.validateSearch as z.ZodType<{
  token?: string
  error?: string
}>

describe('Reset password address', () => {
  it('reads the token of a reset link and the error of a refused one', () => {
    expect(search.parse({ token: TOKEN })).toEqual({ token: TOKEN })
    expect(search.parse({ error: 'INVALID_TOKEN' })).toEqual({ error: 'INVALID_TOKEN' })
  })

  // The router reads `?token=123456` and `?error=1` as numbers. The page is
  // public and is where a locked-out person starts over, so it still opens: on
  // the request form, which sends a new link.
  it('drops a value it cannot read instead of failing the page', () => {
    expect(search.parse({ token: 123456 })).toEqual({})
    expect(search.parse({ error: 1 })).toEqual({})
    expect(search.parse({ token: ['a', 'b'], error: true })).toEqual({})
  })

  it('keeps the key it can read when the other is dropped', () => {
    expect(search.parse({ token: TOKEN, error: 404 })).toEqual({ token: TOKEN })
  })
})
