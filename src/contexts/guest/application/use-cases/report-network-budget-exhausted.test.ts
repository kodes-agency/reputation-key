import { describe, expect, it, vi } from 'vitest'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { isBannedLogKey } from '#/shared/observability/metrics-schema'
import { reportGuestNetworkBudgetExhausted } from './report-network-budget-exhausted'

function recordingLogger() {
  const warn = vi.fn()
  const logger: LoggerPort = {
    info: vi.fn(),
    warn,
    error: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  }
  return { logger, warn }
}

describe('reportGuestNetworkBudgetExhausted', () => {
  it('warns once with the event and the action', () => {
    const { logger, warn } = recordingLogger()

    reportGuestNetworkBudgetExhausted({ logger })({ action: 'submit' })

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: 'guest.network_budget_exhausted', action: 'submit' },
      'Guest network budget exhausted',
    )
  })

  it('carries no address, pseudonym, session or tenant scope, even if a caller passes one', () => {
    const { logger, warn } = recordingLogger()
    const report = reportGuestNetworkBudgetExhausted({ logger }) as (
      input: Record<string, unknown>,
    ) => void

    report({
      action: 'scan',
      ip: '203.0.113.7',
      ipAddress: '203.0.113.7',
      pseudonym: 'pseudonym-1',
      sessionId: 'session-1',
      organizationId: 'organization-1',
      portalId: 'portal-1',
    })

    const [fields] = warn.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(fields).sort()).toEqual(['action', 'event'])
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /203\.0\.113\.7|pseudonym-1|session-1|organization-1|portal-1/u,
    )
  })

  it('logs only keys the log policy approves', () => {
    const { logger, warn } = recordingLogger()

    reportGuestNetworkBudgetExhausted({ logger })({ action: 'google' })

    const [fields] = warn.mock.calls[0] as [Record<string, unknown>]
    for (const key of Object.keys(fields)) expect(isBannedLogKey(key), key).toBe(false)
  })

  it('never lets a failing logger touch the public request', () => {
    const logger: LoggerPort = {
      info: vi.fn(),
      warn: () => {
        throw new Error('log sink is down')
      },
      error: vi.fn(),
      debug: vi.fn(),
      child: () => logger,
    }

    expect(() =>
      reportGuestNetworkBudgetExhausted({ logger })({ action: 'google' }),
    ).not.toThrow()
  })
})
