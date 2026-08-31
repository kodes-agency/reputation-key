import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'
import {
  responseTargetDeadlineRefreshAt,
  scheduleResponseTargetDeadlineRefresh,
} from './response-target-deadline-refresh'

const TARGET: ResponseTargetView = {
  inboxItemId:
    '11111111-1111-4111-8111-111111111111' as ResponseTargetView['inboxItemId'],
  cycleNumber: 1,
  organizationId: 'org-1' as ResponseTargetView['organizationId'],
  propertyId: '22222222-2222-4222-8222-222222222222' as ResponseTargetView['propertyId'],
  targetKind: 'google_review_response',
  eligibility: 'measured',
  durationMinutes: 2_880,
  policySource: 'organization_policy',
  policyVersion: 3,
  startAt: new Date('2026-08-28T08:00:00.000Z'),
  dueAt: new Date('2026-08-30T08:00:00.000Z'),
  completionAt: null,
  result: null,
  stopReason: null,
  propertyTimezone: 'America/New_York',
  evaluation: { state: 'active', overdue: false, elapsedMinutes: 60 },
}

describe('response target deadline refresh', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes exactly when the saved due instant is reached', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T08:00:00.000Z'))
    const refresh = vi.fn()

    const cancel = scheduleResponseTargetDeadlineRefresh({
      dueAt: new Date('2026-08-28T08:00:01.000Z'),
      refresh,
    })

    vi.advanceTimersByTime(999)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    cancel()
  })

  it('cancels a pending refresh when the detail target changes or unmounts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T08:00:00.000Z'))
    const refresh = vi.fn()

    const cancel = scheduleResponseTargetDeadlineRefresh({
      dueAt: new Date('2026-08-28T08:00:01.000Z'),
      refresh,
    })
    cancel()
    vi.advanceTimersByTime(1_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('schedules only an active target whose due boundary is not yet reflected', () => {
    expect(responseTargetDeadlineRefreshAt(TARGET)).toEqual(TARGET.dueAt)
    expect(
      responseTargetDeadlineRefreshAt({
        ...TARGET,
        evaluation: { ...TARGET.evaluation, overdue: true },
      }),
    ).toBeNull()
    expect(
      responseTargetDeadlineRefreshAt({
        ...TARGET,
        completionAt: new Date('2026-08-29T08:00:00.000Z'),
        result: 'on_time',
        stopReason: 'confirmed_on_google',
        evaluation: { state: 'completed', overdue: false, elapsedMinutes: 1_440 },
      }),
    ).toBeNull()
  })
})
