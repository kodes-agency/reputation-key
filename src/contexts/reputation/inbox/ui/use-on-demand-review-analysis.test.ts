import { describe, expect, it } from 'vitest'
import { wantsOnDemandAnalysis } from './use-on-demand-review-analysis'

describe('wantsOnDemandAnalysis', () => {
  it('asks only for a review still waiting in the backlog', () => {
    expect(wantsOnDemandAnalysis('none')).toBe(true)
  })

  it.each(['unavailable', 'disabled', 'ready', 'ready_v3', null])(
    'sends no request for %s',
    (status) => {
      expect(wantsOnDemandAnalysis(status)).toBe(false)
    },
  )
})
