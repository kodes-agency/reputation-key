import type { MerchantAiOverviewEntry } from '#/contexts/identity/application/public-api'
import type {
  AiOrganizationMonthSpend,
  ReviewAnalysisProgress,
} from '#/contexts/ai/application/public-api'

export type AiOverviewStatus = 'on' | 'not_now' | 'turned_off' | 'off'

export function aiOverviewStatus(entry: MerchantAiOverviewEntry): AiOverviewStatus {
  if (entry.state === 'enabled') return 'on'
  if (entry.decisionDeferredAt !== null) return 'not_now'
  if (entry.state === 'revoked') return 'turned_off'
  return 'off'
}

export const AI_OVERVIEW_STATUS_LABEL: Readonly<Record<AiOverviewStatus, string>> = {
  on: 'On',
  not_now: 'Not now',
  turned_off: 'Turned off',
  off: 'Off',
}

const CAPABILITY_LABEL: Readonly<Record<string, string>> = {
  review_analysis: 'Review analysis',
  reply_drafting: 'Reply drafts',
  property_trends: 'Trends',
}

export function aiCapabilityLabel(capability: string): string {
  return CAPABILITY_LABEL[capability] ?? capability
}

export type AiOverviewSummary = Readonly<{
  on: number
  total: number
  reconsent: number
  undecided: number
}>

export function summarizeAiOverview(
  entries: ReadonlyArray<MerchantAiOverviewEntry>,
): AiOverviewSummary {
  return {
    on: entries.filter((entry) => entry.state === 'enabled').length,
    total: entries.length,
    reconsent: entries.filter((entry) => entry.reconsentRequired).length,
    undecided: entries.filter((entry) => aiOverviewStatus(entry) === 'off').length,
  }
}

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

export function formatMicros(micros: number): string {
  return dollars.format(micros / 1_000_000)
}

/** Share of the monthly cap already settled or reserved, 0..1. */
export function spendShare(spend: AiOrganizationMonthSpend): number {
  if (spend.capMicros <= 0) return 0
  return Math.min(1, (spend.settledMicros + spend.reservedMicros) / spend.capMicros)
}

export function analysisSummary(progress: ReviewAnalysisProgress | undefined): string {
  if (progress === undefined) return '…'
  if (progress.status === 'disabled') return 'Analysis off'
  if (progress.status === 'caught_up') return `${progress.analysed} analysed`
  const waiting = progress.queued + progress.inProgress
  return `${progress.analysed} analysed · ${waiting} to go`
}
