import { describe, expect, it } from 'vitest'
import * as providerNeutral from './ai-route-output-schemas'
import * as compatibility from './openai-route-output-schemas'

describe('historical OpenAI route schema module', () => {
  it('re-exports every provider-neutral binding by identity', () => {
    const names = Object.keys(providerNeutral).sort()
    expect(names.length).toBeGreaterThan(10)
    expect(Object.keys(compatibility).sort()).toEqual(names)
    for (const name of names) {
      expect(Reflect.get(compatibility, name)).toBe(Reflect.get(providerNeutral, name))
    }
  })
})
