import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationRightsExecutor,
  type NotificationRightsRun,
} from './notification-rights-executor'
import { runRightsExecutors } from './rights-executor'
import { createRightsJournal } from './rights-journal'
import type { RightsRequestPlan } from './rights-request-command'

const PROPERTY = '5eed0100-0000-4000-8000-000000000001'

function applyPlan(overrides: Partial<RightsRequestPlan> = {}): RightsRequestPlan {
  return {
    scope: 'organization',
    mode: 'apply',
    organizationId: 'org-1',
    batchSize: 50,
    receivedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  }
}

function run(plan: RightsRequestPlan, finalWarning: boolean) {
  const out: string[] = []
  const err: string[] = []
  const puts: string[] = []
  const runs: NotificationRightsRun[] = []
  const executor = createNotificationRightsExecutor({
    finalWarning,
    tables: { organization: ['notifications'] },
    run: vi.fn(async (request) => {
      runs.push(request)
      return { lines: ['queued=1'] }
    }),
  })
  const exit = runRightsExecutors({
    plan,
    executors: [executor],
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    journal: createRightsJournal({
      put: async (key) => {
        puts.push(key)
      },
      alert: vi.fn(),
    }),
    writeExportFile: async () => {},
  })
  return { exit, out, err, puts, runs, executor }
}

describe('notification rights executor', () => {
  it('writes no journal entry for a final-warning apply', async () => {
    const r = run(applyPlan(), true)

    expect(await r.exit).toBe(0)
    expect(r.runs).toHaveLength(1)
    expect(r.puts).toEqual([])
    expect(r.executor.journalContexts).toEqual([])
  })

  it('journals the notification context for a purge apply', async () => {
    const r = run(applyPlan(), false)

    expect(await r.exit).toBe(0)
    expect(r.puts).toHaveLength(1)
  })

  it('ignores a stray Property on an Organization request', async () => {
    const r = run(applyPlan({ propertyId: PROPERTY }), false)

    await r.exit
    expect(r.runs[0]).not.toHaveProperty('propertyId')
  })

  it('passes the Property for a Property request', async () => {
    const r = run(applyPlan({ scope: 'property', propertyId: PROPERTY }), false)

    await r.exit
    expect(r.err).toEqual([])
    expect(r.runs[0]).toMatchObject({ scope: 'property', propertyId: PROPERTY })
  })
})
