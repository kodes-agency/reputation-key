import { describe, expect, it } from 'vitest'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ADMISSION_LANES,
  AI_ADMISSION_LEASE_MILLIS,
  AI_ADMISSION_RATE_PER_MINUTE,
  AI_ADMISSION_SCOPES,
  AI_ON_DEMAND_ANALYSIS_INTERACTIVE_HEADROOM,
  AI_PROVIDER_ACCOUNT_LIMITS_PER_MINUTE,
  isAiAdmissionLane,
} from './admission-lanes'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { REVIEW_ANALYSIS_V3_LOGICAL_PROFILE } from '#/shared/review-analysis-v3-profile'

// What the provider counts against its token limit for one analysis is what the
// request sends plus its output ceiling, which it reserves before it answers.
// The input sizes are measured: v2 on a real import (2026-09-28), v3 on the
// quality check of 424 synthetic reviews (2026-10-30, `gpt-6-luna`: 1,599,608
// input tokens, 3,773 each).
const V2_ANALYSIS_INPUT_TOKENS = 600
const V3_ANALYSIS_INPUT_TOKENS = 3_800

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

  it('keeps both global lanes under half of the provider account limits', () => {
    // v2 is retired and its profile stays; v3 is the analysis that runs. The
    // larger of the two bounds what the lane may admit.
    const v2 = AI_OPERATION_PROFILES.find(
      (profile) => profile.profileVersion === 'review-analysis-v2',
    )
    const analysisTokens = Math.max(
      V2_ANALYSIS_INPUT_TOKENS + (v2?.maxOutputTokens ?? Number.POSITIVE_INFINITY),
      V3_ANALYSIS_INPUT_TOKENS +
        REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.maxOutputTokens,
    )
    const { global } = AI_ADMISSION_RATE_PER_MINUTE

    expect(global.interactive + global.background).toBeLessThanOrEqual(
      AI_PROVIDER_ACCOUNT_LIMITS_PER_MINUTE.requests / 2,
    )
    expect(global.background * analysisTokens).toBeLessThanOrEqual(
      AI_PROVIDER_ACCOUNT_LIMITS_PER_MINUTE.tokens / 2,
    )
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
