import { describe, it, expect } from 'vitest'
import { assertNever, UnreachableError } from './assert'

describe('assertNever', () => {
  it('throws UnreachableError', () => {
    expect(() => assertNever('test', 'unexpected' as never)).toThrow(UnreachableError)
    expect(() => assertNever('test', 'unexpected' as never)).toThrow(
      'Unreachable: unexpected value in test',
    )
  })
})
