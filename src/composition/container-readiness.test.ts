import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginContainerDrain,
  markContainerReady,
  markContainerFailed,
} from './container-lifecycle'
import { isContainerReady } from './container-readiness.server'

const mocks = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('#/composition', () => ({
  getContainer: () => {
    mocks.build()
    markContainerReady()
  },
}))
afterEach(() => {
  mocks.build.mockReset()
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('repkey.composition.lifecycle')
  ]
})

describe('container readiness', () => {
  it('proves construction before admitting traffic', () => {
    expect(isContainerReady()).toBe(true)
    expect(mocks.build).toHaveBeenCalledOnce()
  })
  it('reports a construction failure as not ready instead of throwing', () => {
    mocks.build.mockImplementationOnce(() => {
      throw new Error('a key group is missing')
    })
    expect(isContainerReady()).toBe(false)
  })
  it.each(['draining', 'failed'] as const)('never constructs while %s', (state) => {
    if (state === 'draining') beginContainerDrain()
    else markContainerFailed()
    expect(isContainerReady()).toBe(false)
    expect(mocks.build).not.toHaveBeenCalled()
  })
})
