import type { PortalLifetimeReconciliationState } from '#/contexts/dashboard/application/public-api'
import { formatEvidenceTime } from './portal-metric-evidence-presentation'

export type PortalLifetimeReconciliationPresentation = Readonly<{
  summary: string
  revision: string
  lastCheck: string
  anonymousBaseline: string
  lastRetentionCheckpoint: string
}>

function formatLocalDate(value: string, locale?: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function portalLifetimeReconciliationPresentation(
  state: PortalLifetimeReconciliationState,
  locale?: string,
  timeZone?: string,
): PortalLifetimeReconciliationPresentation {
  const summary =
    state.state === 'reconciled'
      ? 'All-time totals passed their latest consistency check.'
      : state.state === 'awaiting_first_reconciliation'
        ? 'All-time totals are available while their first consistency check finishes.'
        : 'All-time totals are preparing.'

  return {
    summary,
    revision:
      state.projectionRevision === null
        ? 'Not available yet'
        : `Revision ${state.projectionRevision.toLocaleString(locale)}`,
    lastCheck:
      state.lastRebuiltAt === null
        ? 'Not completed yet'
        : formatEvidenceTime(state.lastRebuiltAt, locale, timeZone),
    anonymousBaseline:
      state.sealedThroughLocalDate === null
        ? 'Not established yet'
        : `Through ${formatLocalDate(state.sealedThroughLocalDate, locale)}`,
    lastRetentionCheckpoint:
      state.lastSealedAt === null
        ? 'Not completed yet'
        : formatEvidenceTime(state.lastSealedAt, locale, timeZone),
  }
}
