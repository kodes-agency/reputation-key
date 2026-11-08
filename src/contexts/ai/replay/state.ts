import type { ReviewAnalysisEnrollmentState } from './contracts'

export type ReviewAnalysisReplayState =
  'preparing' | 'running' | 'caught_up' | 'needs_attention'

/** Keep the persisted enrollment vocabulary and its public readiness contract. */
export function reviewAnalysisReplayState(
  state: ReviewAnalysisEnrollmentState,
): ReviewAnalysisReplayState {
  switch (state) {
    case 'queued':
    case 'awaiting_assisted_approval':
      return 'preparing'
    case 'running':
      return 'running'
    case 'caught_up':
      return 'caught_up'
    case 'superseded':
    case 'stalled':
      return 'needs_attention'
  }
}
