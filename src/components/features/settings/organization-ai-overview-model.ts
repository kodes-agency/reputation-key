import type { MerchantAiOverviewEntry } from '#/contexts/identity/application/public-api'
import type {
  AiOrganizationMonthSpend,
  ReviewAnalysisProgress,
} from '#/contexts/ai/application/public-api'
import type { StatusMap } from '#/components/ui/status-badge'
import { formatNumber } from '#/lib/format'

export type AiOverviewStatus = 'on' | 'paused' | 'not_now' | 'turned_off' | 'off'

export function aiOverviewStatus(entry: MerchantAiOverviewEntry): AiOverviewStatus {
  if (entry.state === 'enabled') return entry.reconsentRequired ? 'paused' : 'on'
  if (entry.state === 'revoked') return 'turned_off'
  if (entry.decisionDeferredAt !== null) return 'not_now'
  return 'off'
}

/** How a property's AI state reads as a pill: only "On" is a colour. */
export const AI_OVERVIEW_STATUS: StatusMap<AiOverviewStatus> = {
  paused: { label: 'Paused — needs attention', tone: 'warn' },
  on: { label: 'On', tone: 'positive' },
  not_now: { label: 'Not now', tone: 'neutral' },
  turned_off: { label: 'Off', tone: 'neutral' },
  off: { label: 'Off', tone: 'neutral' },
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
    on: entries.filter((entry) => aiOverviewStatus(entry) === 'on').length,
    total: entries.length,
    reconsent: entries.filter((entry) => aiOverviewStatus(entry) === 'paused').length,
    undecided: entries.filter((entry) => aiOverviewStatus(entry) === 'off').length,
  }
}

export function formatMicros(micros: number): string {
  return formatNumber(micros / 1_000_000, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
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

/** A paused Property needs a practical next step, never a new consent ceremony. */
export function aiPauseReason(reason: string | null | undefined): string {
  const reasons: Readonly<Record<string, string>> = {
    google_unbound: 'Reconnect Google',
    no_account_admin: 'No account admin',
    property_not_manageable: 'Restore this property to continue',
    source_changed: 'Check this property’s Google connection',
    org_suspended: 'Your account is paused — contact support',
    policy_denied: 'AI is unavailable — contact support',
    update_pending:
      'The automatic update is waiting. If it stays paused, contact support.',
  }
  return reasons[reason ?? 'update_pending'] ?? reasons.update_pending!
}
