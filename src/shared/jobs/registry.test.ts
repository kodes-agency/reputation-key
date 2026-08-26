import { describe, expect, it } from 'vitest'
import { createJobRegistry, type JobHandler } from './registry'

describe('JobRegistry', () => {
  it('rejects duplicate registration without replacing the original handler', () => {
    const registry = createJobRegistry()
    const original: JobHandler = async () => 'original'
    const duplicate: JobHandler = async () => 'duplicate'

    registry.register('review.sync', original)

    expect(() => registry.register('review.sync', duplicate)).toThrow(
      'Job handler "review.sync" is already registered',
    )
    expect(registry.getHandler('review.sync')).toBe(original)
  })
})
