import { describe, expect, it } from 'vitest'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ADMISSION_LANES,
  AI_ADMISSION_LEASE_MILLIS,
  AI_ADMISSION_RATE_PER_MINUTE,
  AI_ADMISSION_SCOPES,
  AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
  isAiAdmissionLane,
} from './admission-lanes'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'

describe('AI admission lanes', () => {
  it('gives every scope and lane a positive integer budget', () => {
    for (const table of [AI_ADMISSION_RATE_PER_MINUTE, AI_ADMISSION_IN_FLIGHT]) {
      for (const scope of AI_ADMISSION_SCOPES) {
        for (const lane of AI_ADMISSION_LANES) {
          const value = table[scope][lane]
          expect(Number.isSafeInteger(value) && value > 0).toBe(true)
        }
      }
    }
  })

  it('never lets a narrower scope exceed a wider one in the same lane', () => {
    for (const table of [AI_ADMISSION_RATE_PER_MINUTE, AI_ADMISSION_IN_FLIGHT]) {
      for (const lane of AI_ADMISSION_LANES) {
        expect(table.property[lane]).toBeLessThanOrEqual(table.organization[lane])
        expect(table.organization[lane]).toBeLessThanOrEqual(table.global[lane])
      }
    }
  })

  it('leaves the interactive lane usable after on-demand analysis headroom', () => {
    for (const scope of AI_ADMISSION_SCOPES) {
      expect(AI_ADMISSION_RATE_PER_MINUTE[scope].interactive).toBeGreaterThan(
        AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
      )
    }
  })

  it('holds an in-flight slot longer than any admitted request deadline', () => {
    const longestDeadline = Math.max(
      ...AI_OPERATION_PROFILES.filter(
        (profile) => profile.command === 'analysis' || profile.command === 'reply',
      ).map((profile) => profile.requestDeadlineMs),
    )
    expect(AI_ADMISSION_LEASE_MILLIS).toBeGreaterThan(longestDeadline)
  })

  it('recognises only the two lanes', () => {
    expect(isAiAdmissionLane('interactive')).toBe(true)
    expect(isAiAdmissionLane('background')).toBe(true)
    expect(isAiAdmissionLane('batch')).toBe(false)
    expect(isAiAdmissionLane(undefined)).toBe(false)
  })
})
