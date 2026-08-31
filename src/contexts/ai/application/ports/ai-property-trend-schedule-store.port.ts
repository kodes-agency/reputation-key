import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiTrendEvidence, AiTrendReport } from './ai-output-store.port'

export type AiPropertyTrendSchedule = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  dueLocalDate: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyTrendsEpoch: number
  propertyProfileVersion: number
  terminalAnalysisSequence: number
  aggregateRevision: number
  timezone: string
  calendarProfileVersion: 'property-calendar-v1'
  reportProfileVersion: 'property-trend-v1'
  schedulerGeneration: number
  scheduledAtEpochMillis: number
  outcomeDisposition:
    'ready' | 'updating' | 'insufficient_data' | 'no_material_change' | null
}>

export type AiPropertyTrendScheduleStorePort = Readonly<{
  scheduleDueBatch(input: Readonly<{ leaseOwner: string }>): Promise<
    | Readonly<{ status: 'busy' }>
    | Readonly<{
        status: 'scheduled'
        schedulerGeneration: number
        scheduledCount: number
        hasMore: boolean
      }>
  >

  read(scheduleId: string): Promise<AiPropertyTrendSchedule | null>

  recordProviderFreeOutcome(
    input: Readonly<{
      scheduleId: string
      disposition: 'updating' | 'insufficient_data' | 'no_material_change'
      evidence: AiTrendEvidence
    }>,
  ): Promise<'recorded' | 'replayed' | 'stale'>

  recordDeterministicReport(
    input: Readonly<{
      scheduleId: string
      selectedSignalIds: readonly string[]
      report: AiTrendReport &
        Required<Pick<AiTrendReport, 'headline' | 'sentences' | 'summary'>>
      evidence: AiTrendEvidence
    }>,
  ): Promise<'recorded' | 'replayed' | 'stale'>
}>
