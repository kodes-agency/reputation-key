import { describe, expect, it } from 'vitest'
import type { MerchantAiOverviewEntry } from '#/contexts/identity/application/public-api'
import {
  aiOverviewStatus,
  analysisSummary,
  formatMicros,
  spendShare,
  summarizeAiOverview,
} from './organization-ai-overview-model'

const entry = (
  overrides: Partial<MerchantAiOverviewEntry> = {},
): MerchantAiOverviewEntry => ({
  propertyId: '10000000-0000-4000-8000-000000000101',
  propertyName: 'Harborline Suites',
  state: 'disabled',
  capabilities: [],
  noticeVersion: null,
  reconsentRequired: false,
  decisionDeferredAt: null,
  googleBindingActive: true,
  ...overrides,
})

describe('organization AI overview model', () => {
  it('reads a property as on, not now, turned off or off', () => {
    expect(aiOverviewStatus(entry({ state: 'enabled' }))).toBe('on')
    expect(
      aiOverviewStatus(entry({ decisionDeferredAt: '2026-09-15T10:00:00.000Z' })),
    ).toBe('not_now')
    expect(aiOverviewStatus(entry({ state: 'revoked' }))).toBe('turned_off')
    expect(aiOverviewStatus(entry())).toBe('off')
  })

  it('counts properties on, needing re-consent and still undecided', () => {
    expect(
      summarizeAiOverview([
        entry({ state: 'enabled', reconsentRequired: true }),
        entry({ state: 'enabled' }),
        entry({ decisionDeferredAt: '2026-09-15T10:00:00.000Z' }),
        entry(),
      ]),
    ).toEqual({ on: 2, total: 4, reconsent: 1, undecided: 1 })
  })

  it('formats spend and caps the share at the monthly limit', () => {
    expect(formatMicros(1_250_000)).toBe('$1.25')
    expect(
      spendShare({
        monthStartEpochMillis: 0,
        settledMicros: 40_000_000,
        reservedMicros: 20_000_000,
        capMicros: 50_000_000,
      }),
    ).toBe(1)
  })

  it('summarises analysis progress in a few words', () => {
    expect(analysisSummary(undefined)).toBe('…')
    expect(analysisSummary({ status: 'disabled' })).toBe('Analysis off')
    expect(
      analysisSummary({
        status: 'analysing',
        queued: 50,
        inProgress: 2,
        analysed: 44,
        notAnalysable: 0,
        verifiedThroughEpochMillis: null,
      }),
    ).toBe('44 analysed · 52 to go')
  })
})
