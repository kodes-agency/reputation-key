export const GOOGLE_OAUTH_V1_STATE_TTL_MS = 10 * 60 * 1000
export const GOOGLE_OAUTH_V1_STATE_SKEW_MS = 60 * 1000
export const GOOGLE_OAUTH_V1_STATE_DRAIN_MS =
  GOOGLE_OAUTH_V1_STATE_TTL_MS + GOOGLE_OAUTH_V1_STATE_SKEW_MS

export type GoogleImportCompatibilityControl = Readonly<{
  state: 'open' | 'quiescing' | 'closed'
  generation: number
  connectedEventIssuance: 'v1' | 'v2'
  oauthStateIssuance: 'signed-v1' | 'opaque-v2'
  connectedEventConvergedAt: Date | null
  oauthStateConvergedAt: Date | null
  v1StateDrainNotBefore: Date | null
  v1EventsDrainedAt: Date | null
  quiescingAt: Date | null
  closedAt: Date | null
  operatorId: string | null
  reason: string | null
  updatedAt: Date
}>

export const GOOGLE_IMPORT_LEGACY_BULL_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waitingChildren',
  'paused',
  'completed',
  'failed',
] as const

export type GoogleImportLegacyBullState =
  (typeof GOOGLE_IMPORT_LEGACY_BULL_STATES)[number]

export type GoogleImportCompatibilityInspection = Readonly<{
  control: GoogleImportCompatibilityControl
  legacyRows: Readonly<{
    total: number
    nonterminal: number
    statuses: Readonly<Record<string, number>>
  }>
  outbox: Readonly<{
    pendingConnectedV1: number
  }>
  leases: Readonly<{
    active: number
  }>
  queues: Readonly<{
    legacyJobs: Readonly<Record<GoogleImportLegacyBullState, number>>
    legacySchedulers: number
    legacyRepeatables: number
    pendingConnectedV1: number
  }>
}>

export type GoogleImportCompatibilityBlocker =
  | 'connected_event_v1_issuance'
  | 'oauth_state_v1_issuance'
  | 'v1_events_not_drained'
  | 'legacy_rows_nonterminal'
  | 'legacy_queue_not_empty'
  | 'legacy_scheduler_not_empty'
  | 'legacy_repeatable_not_empty'
  | 'v1_event_queue_not_drained'
  | 'legacy_effect_lease_active'
  | 'v1_outbox_not_drained'

export type GoogleImportCompatibilityReport = GoogleImportCompatibilityInspection &
  Readonly<{ blockers: readonly GoogleImportCompatibilityBlocker[] }>

export type GoogleImportCompatibilityMutation = Readonly<{
  operatorId: string
  reason: string
  now: Date
}>

type FencedMutation = GoogleImportCompatibilityMutation &
  Readonly<{ expectedGeneration: number }>

export type GoogleImportCompatibilityArchiveResult = Readonly<{
  sourceCount: number
  archivedCount: number
  deletedCount: number
  sourceDigest: string
  archivedDigest: string
}>

export type GoogleImportCompatibilityPort = Readonly<{
  inspect: () => Promise<GoogleImportCompatibilityInspection>
  advanceConnectedEventIssuance: (
    input: FencedMutation,
  ) => Promise<GoogleImportCompatibilityControl>
  advanceOauthStateIssuance: (
    input: FencedMutation & Readonly<{ drainNotBefore: Date }>,
  ) => Promise<GoogleImportCompatibilityControl>
  markV1EventsDrained: (
    input: FencedMutation,
  ) => Promise<GoogleImportCompatibilityControl>
  beginQuiescing: (input: FencedMutation) => Promise<GoogleImportCompatibilityControl>
  removeDormantLegacyQueueEntries: (input: FencedMutation) => Promise<void>
  close: (input: FencedMutation) => Promise<GoogleImportCompatibilityControl>
  archiveTerminalRows: (
    input: FencedMutation,
  ) => Promise<GoogleImportCompatibilityArchiveResult>
}>

function totalLegacyJobs(
  jobs: GoogleImportCompatibilityInspection['queues']['legacyJobs'],
): number {
  return GOOGLE_IMPORT_LEGACY_BULL_STATES.reduce((total, state) => total + jobs[state], 0)
}

export function googleImportCompatibilityBlockers(
  inspection: GoogleImportCompatibilityInspection,
): readonly GoogleImportCompatibilityBlocker[] {
  const blockers: GoogleImportCompatibilityBlocker[] = []
  if (inspection.control.connectedEventIssuance !== 'v2') {
    blockers.push('connected_event_v1_issuance')
  }
  if (inspection.control.oauthStateIssuance !== 'opaque-v2') {
    blockers.push('oauth_state_v1_issuance')
  }
  if (!inspection.control.v1EventsDrainedAt) blockers.push('v1_events_not_drained')
  if (inspection.legacyRows.nonterminal > 0) blockers.push('legacy_rows_nonterminal')
  if (totalLegacyJobs(inspection.queues.legacyJobs) > 0) {
    blockers.push('legacy_queue_not_empty')
  }
  if (inspection.queues.legacySchedulers > 0) {
    blockers.push('legacy_scheduler_not_empty')
  }
  if (inspection.queues.legacyRepeatables > 0) {
    blockers.push('legacy_repeatable_not_empty')
  }
  if (inspection.queues.pendingConnectedV1 > 0) {
    blockers.push('v1_event_queue_not_drained')
  }
  if (inspection.leases.active > 0) blockers.push('legacy_effect_lease_active')
  if (inspection.outbox.pendingConnectedV1 > 0) {
    blockers.push('v1_outbox_not_drained')
  }
  return blockers
}

function assertMutation(input: GoogleImportCompatibilityMutation): void {
  if (!input.operatorId.trim()) throw new Error('operatorId is required')
  if (!input.reason.trim()) throw new Error('reason is required')
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new Error('now must be a valid Date')
  }
}

function fenced(
  input: GoogleImportCompatibilityMutation,
  control: GoogleImportCompatibilityControl,
): FencedMutation {
  assertMutation(input)
  return { ...input, expectedGeneration: control.generation }
}

function assertNoCloseBlockers(report: GoogleImportCompatibilityReport): void {
  if (report.blockers.length > 0) {
    throw new Error(`compatibility close blocked: ${report.blockers.join(',')}`)
  }
}

export function createGoogleImportCompatibilityLifecycle(
  port: GoogleImportCompatibilityPort,
) {
  const inspect = async (): Promise<GoogleImportCompatibilityReport> => {
    const inspection = await port.inspect()
    return { ...inspection, blockers: googleImportCompatibilityBlockers(inspection) }
  }

  return {
    inspect,

    switchConnectedEvents: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityControl> => {
      const report = await inspect()
      if (report.control.connectedEventIssuance === 'v2') return report.control
      if (report.control.state !== 'open') {
        throw new Error('connected-event issuance can switch only while open')
      }
      return port.advanceConnectedEventIssuance(fenced(input, report.control))
    },

    switchOauthState: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityControl> => {
      const report = await inspect()
      if (report.control.oauthStateIssuance === 'opaque-v2') return report.control
      if (report.control.state !== 'open') {
        throw new Error('OAuth-state issuance can switch only while open')
      }
      if (report.control.connectedEventIssuance !== 'v2') {
        throw new Error('connected-event issuance is not v2')
      }
      const mutation = fenced(input, report.control)
      return port.advanceOauthStateIssuance({
        ...mutation,
        drainNotBefore: new Date(input.now.getTime() + GOOGLE_OAUTH_V1_STATE_DRAIN_MS),
      })
    },

    markV1EventsDrained: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityControl> => {
      const report = await inspect()
      if (report.control.v1EventsDrainedAt) return report.control
      if (report.control.oauthStateIssuance !== 'opaque-v2') {
        throw new Error('OAuth-state issuance is not opaque-v2')
      }
      if (report.outbox.pendingConnectedV1 > 0 || report.queues.pendingConnectedV1 > 0) {
        throw new Error('v1 connected events remain in outbox or Bull delivery')
      }
      return port.markV1EventsDrained(fenced(input, report.control))
    },

    quiesce: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityControl> => {
      const report = await inspect()
      if (report.control.state === 'quiescing' || report.control.state === 'closed') {
        return report.control
      }
      if (
        report.control.oauthStateIssuance !== 'opaque-v2' ||
        !report.control.v1EventsDrainedAt
      ) {
        throw new Error('compatibility issuance has not converged')
      }
      const notBefore = report.control.v1StateDrainNotBefore
      if (!notBefore || input.now.getTime() < notBefore.getTime()) {
        throw new Error('v1 OAuth state drain lifetime has not elapsed')
      }
      return port.beginQuiescing(fenced(input, report.control))
    },

    drainLegacyQueues: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<void> => {
      const report = await inspect()
      if (report.control.state === 'closed') return
      if (report.control.state !== 'quiescing') {
        throw new Error('legacy queues can drain only while quiescing')
      }
      if (report.legacyRows.nonterminal > 0) {
        throw new Error('legacy rows are not terminal')
      }
      if (report.queues.legacyJobs.active > 0) {
        throw new Error('legacy Bull jobs are still active')
      }
      await port.removeDormantLegacyQueueEntries(fenced(input, report.control))
      const after = await inspect()
      const remaining = after.blockers.filter((blocker) =>
        [
          'legacy_queue_not_empty',
          'legacy_scheduler_not_empty',
          'legacy_repeatable_not_empty',
        ].includes(blocker),
      )
      if (remaining.length > 0) {
        throw new Error(`legacy Bull drain incomplete: ${remaining.join(',')}`)
      }
    },

    close: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityControl> => {
      const report = await inspect()
      if (report.control.state === 'closed') return report.control
      if (report.control.state !== 'quiescing') {
        throw new Error('compatibility lifecycle is not quiescing')
      }
      assertNoCloseBlockers(report)
      return port.close(fenced(input, report.control))
    },

    archive: async (
      input: GoogleImportCompatibilityMutation,
    ): Promise<GoogleImportCompatibilityArchiveResult> => {
      const report = await inspect()
      if (report.control.state !== 'closed') {
        throw new Error('legacy rows can archive only after close')
      }
      assertNoCloseBlockers(report)
      const result = await port.archiveTerminalRows(fenced(input, report.control))
      if (
        result.sourceCount !== result.archivedCount ||
        result.sourceCount !== result.deletedCount ||
        result.sourceDigest !== result.archivedDigest
      ) {
        throw new Error('archive parity failed')
      }
      return result
    },
  } as const
}
