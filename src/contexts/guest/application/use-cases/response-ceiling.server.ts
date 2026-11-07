import type { GuestResponseScope } from '../ports/guest-response.repository'
import type { GuestResponseView } from './guest-response-lifecycle'
import type { GuestSession } from '../../domain/guest-session'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  ORGANIZATION_RESPONSE_DAILY_LIMIT,
  PORTAL_RESPONSE_DAILY_LIMIT,
  PORTAL_RESPONSE_HOURLY_LIMIT,
} from './response-ceiling-budgets'

export type ResponseAdmission = Readonly<{
  allowed: boolean
  recordedAt: Date
  expiresAt: Date
}>
export type ResponseCeilingCounts = Readonly<{
  portalHour: number
  portalDay: number
  organizationDay: number
}>
export type ResponseCeilingTransaction = Readonly<{
  find(scope: GuestResponseScope, sessionId: string): Promise<ResponseAdmission | null>
  counts(scope: GuestResponseScope, now: Date): Promise<ResponseCeilingCounts>
  record(
    scope: GuestResponseScope,
    sessionId: string,
    admission: ResponseAdmission,
  ): Promise<void>
  claimAlert(
    scope: GuestResponseScope,
    window: keyof ResponseCeilingCounts,
    start: Date,
  ): Promise<boolean>
}>
export type ResponseCeilingStore = Readonly<{
  withinOrganization<T>(
    organizationId: string,
    run: (tx: ResponseCeilingTransaction) => Promise<T>,
  ): Promise<T>
  find: ResponseCeilingTransaction['find']
}>

export function droppedResponseView(
  submittedAt: Date,
  rating: number | null,
): GuestResponseView {
  return {
    dropped: true,
    status: 'submitted',
    rating,
    hasPrivateFeedback: false,
    privateFeedbackEligible: false,
    submittedAt: submittedAt.toISOString(),
    correctedAt: null,
    correctionDeadline: null,
    correctionAvailable: false,
    responseWithdrawalDeadline: null,
    responseWithdrawalAvailable: false,
    feedbackSubmittedAt: null,
    feedbackWithdrawalDeadline: null,
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: null,
    deletedAt: null,
  }
}

export function responseWindowStart(
  now: Date,
  window: keyof ResponseCeilingCounts,
): Date {
  const start = new Date(now)
  if (window === 'portalHour') start.setUTCMinutes(0, 0, 0)
  else start.setUTCHours(0, 0, 0, 0)
  return start
}

export function createResponseCeiling(
  deps: Readonly<{
    store: ResponseCeilingStore
    clock: () => Date
    logger: LoggerPort
    organizationDailyLimit?: number
  }>,
) {
  const limits = {
    portalHour: PORTAL_RESPONSE_HOURLY_LIMIT,
    portalDay: PORTAL_RESPONSE_DAILY_LIMIT,
    organizationDay: deps.organizationDailyLimit ?? ORGANIZATION_RESPONSE_DAILY_LIMIT,
  }
  if (!Number.isSafeInteger(limits.organizationDay) || limits.organizationDay < 1) {
    throw new Error('Organization response limit must be a positive integer')
  }
  return {
    reserve: async (
      scope: GuestResponseScope,
      sessionId: string,
    ): Promise<ResponseAdmission> => {
      const result = await deps.store.withinOrganization(
        scope.organizationId,
        async (tx) => {
          // Read the clock after acquiring the lock: queued requests belong to the
          // window in which they are admitted, not the window in which they arrived.
          const now = deps.clock()
          const existing = await tx.find(scope, sessionId)
          if (existing) return { admission: existing, alerts: [] }
          const counts = await tx.counts(scope, now)
          const windows = (
            Object.keys(limits) as Array<keyof ResponseCeilingCounts>
          ).filter((window) => counts[window] >= limits[window])
          const admission = {
            allowed: windows.length === 0,
            recordedAt: now,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          }
          await tx.record(scope, sessionId, admission)
          const alerts: Array<keyof ResponseCeilingCounts> = []
          for (const window of windows) {
            if (await tx.claimAlert(scope, window, responseWindowStart(now, window))) {
              alerts.push(window)
            }
          }
          return { admission, alerts }
        },
      )
      for (const window of result.alerts) {
        try {
          deps.logger.warn(
            { event: 'guest.response_ceiling_exhausted', window },
            'Guest response ceiling exhausted',
          )
        } catch {
          // Logging cannot change the committed admission or public navigation.
        }
      }
      return result.admission
    },
    getDropped: async (
      scope: GuestResponseScope,
      session: GuestSession,
    ): Promise<GuestResponseView | null> => {
      const admission = await deps.store.find(scope, session.sessionId)
      if (!admission || admission.allowed || admission.expiresAt <= deps.clock())
        return null
      const rating =
        session.droppedResponse?.submittedAt === admission.recordedAt.toISOString()
          ? session.droppedResponse.rating
          : null
      return droppedResponseView(admission.recordedAt, rating)
    },
  }
}
