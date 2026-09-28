import { describe, expect, it } from 'vitest'
import {
  REVIEW_ANALYSIS_PROGRESS_POLL_MS,
  reviewAnalysisProgressRefetchInterval,
} from './review-analysis-progress-polling'

function read(data?: Readonly<{ status: string }>) {
  return reviewAnalysisProgressRefetchInterval({ state: { data } })
}

describe('review analysis progress polling', () => {
  it('re-reads the counts every few seconds while analysis runs', () => {
    expect(read({ status: 'analysing' })).toBe(REVIEW_ANALYSIS_PROGRESS_POLL_MS)
  })

  it.each(['caught_up', 'disabled'])('stays put once progress reads %s', (status) => {
    expect(read({ status })).toBe(false)
  })

  it('waits for the first read before polling', () => {
    expect(read()).toBe(false)
  })
})
