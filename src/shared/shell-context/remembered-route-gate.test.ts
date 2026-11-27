// A controlled route's gate: asked on every server render, and in the browser
// remembered for 30 seconds under the person, the capability and the Property.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { CapabilityDecision } from '#/shared/auth/beta-capabilities'

const { checkControlledRoute } = vi.hoisted(() => ({ checkControlledRoute: vi.fn() }))
vi.mock('#/shared/auth/controlled-route-check', () => ({ checkControlledRoute }))

import { gateControlledRoute } from './remembered-route-gate'
import {
  invalidateShellContext,
  shellContextKeys,
} from '#/shared/queries/shell-context-cache'

const START = new Date('2026-10-28T10:00:00Z').getTime()

const allowed: CapabilityDecision = {
  allowed: true,
  reason: 'allowed',
  capability: 'goal.use',
}
const denied: CapabilityDecision = {
  allowed: false,
  reason: 'capability_disabled',
  capability: 'goal.use',
}

describe('gateControlledRoute', () => {
  let queryClient: QueryClient
  const gate = (userId = 'user-1', capability: 'goal.use' | 'staff.use' = 'goal.use') =>
    gateControlledRoute({
      context: { queryClient, user: { id: userId } },
      data: { capability, featureLabel: 'Goals' },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'], now: START })
    queryClient = new QueryClient()
    checkControlledRoute.mockResolvedValue(allowed)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks the server on every server render and keeps nothing', async () => {
    await gate()
    await gate()

    expect(checkControlledRoute).toHaveBeenCalledTimes(2)
    expect(
      queryClient.getQueryCache().findAll({ queryKey: shellContextKeys.all }),
    ).toEqual([])
  })

  describe('in the browser', () => {
    beforeEach(() => {
      vi.stubGlobal('document', {})
    })

    it('opens the page again within 30 seconds without asking', async () => {
      await gate()
      vi.setSystemTime(START + 29_999)
      await gate()

      expect(checkControlledRoute).toHaveBeenCalledOnce()
      expect(checkControlledRoute).toHaveBeenCalledWith({
        data: { capability: 'goal.use', featureLabel: 'Goals' },
      })
    })

    it('asks again after 30 seconds', async () => {
      await gate()
      vi.setSystemTime(START + 30_001)
      await gate()

      expect(checkControlledRoute).toHaveBeenCalledTimes(2)
    })

    it('asks for each capability and person on its own', async () => {
      await gate()
      await gate('user-2')
      await gate('user-1', 'staff.use')

      expect(checkControlledRoute).toHaveBeenCalledTimes(3)
    })

    it('answers a remembered refusal with the same notice', async () => {
      checkControlledRoute.mockResolvedValue(denied)
      const notice = {
        data: { cause: 'feature', title: 'Goals', category: 'not_in_beta' },
      }

      await expect(gate()).rejects.toMatchObject(notice)
      await expect(gate()).rejects.toMatchObject(notice)
      expect(checkControlledRoute).toHaveBeenCalledOnce()
    })

    it('keeps no failure: the next navigation asks again', async () => {
      checkControlledRoute.mockRejectedValueOnce(new Error('policy store down'))

      await expect(gate()).rejects.toThrow('policy store down')
      await gate()
      expect(checkControlledRoute).toHaveBeenCalledTimes(2)
    })

    it('answers from the server, not with a cancellation, when a forget lands mid-check', async () => {
      let answer: (decision: typeof allowed) => void = () => undefined
      checkControlledRoute.mockImplementationOnce(
        () => new Promise<typeof allowed>((resolve) => (answer = resolve)),
      )
      const pending = gate()
      invalidateShellContext(queryClient)
      answer(allowed)

      await expect(pending).resolves.toBeUndefined()
      expect(checkControlledRoute).toHaveBeenCalledTimes(2)
    })

    it('asks again after the shell context is invalidated', async () => {
      await gate()
      invalidateShellContext(queryClient)
      await gate()

      expect(checkControlledRoute).toHaveBeenCalledTimes(2)
    })
  })
})
