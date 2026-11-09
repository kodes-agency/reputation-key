import { describe, expect, it } from 'vitest'
import { planReplaySnapshot } from './snapshot'

describe('history replay snapshot refresh', () => {
  const stored = { count: 2, digest: 'a'.repeat(64) }

  it('keeps an unchanged approved population and its evidence', () => {
    expect(planReplaySnapshot(stored, stored, 10_000)).toEqual({ status: 'unchanged' })
  })

  it('prepares the changed revision set again instead of stalling', () => {
    expect(
      planReplaySnapshot(stored, { count: 2, digest: 'b'.repeat(64) }, 10_000),
    ).toEqual({ status: 'refresh', assistedApprovalRequired: false })
  })

  it('refreshes when expired or newly eligible sources change the count', () => {
    expect(
      planReplaySnapshot(stored, { count: 0, digest: 'b'.repeat(64) }, 10_000),
    ).toEqual({ status: 'refresh', assistedApprovalRequired: false })
  })

  it('requires fresh assisted approval when the new snapshot exceeds the ceiling', () => {
    expect(
      planReplaySnapshot(stored, { count: 10_001, digest: 'b'.repeat(64) }, 10_000),
    ).toEqual({ status: 'refresh', assistedApprovalRequired: true })
  })

  it('does not require assisted approval at the ceiling', () => {
    expect(
      planReplaySnapshot(stored, { count: 10_000, digest: 'b'.repeat(64) }, 10_000),
    ).toEqual({ status: 'refresh', assistedApprovalRequired: false })
  })
})
