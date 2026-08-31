import { describe, it, expect, vi } from 'vitest'

import { projectRecentActivity } from './project-recent-activity'
import { createSimulationContainer } from '#/shared/testing/simulation-container.server'
import {
  organizationId,
  userId,
  propertyId,
  recentActivityEntryId,
} from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

describe('projectRecentActivity', () => {
  it('inserts log via repo and emits event', async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    const repo = { insert, findDuplicate: vi.fn().mockResolvedValue(null) } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const idGen = () => recentActivityEntryId('act-1')
    const clock = () => new Date('2026-06-01T12:00:00Z')
    const userLookup = {
      lookup: vi.fn().mockResolvedValue({
        name: 'Test User',
        avatarUrl: null,
        role: 'Staff' as Role,
        rawRole: 'Staff',
      }),
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any

    const deps = { repo, userLookup, clock, logger, idGen }

    await projectRecentActivity(deps)({
      action: 'created' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      resourceType: 'property' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      resourceId: 'p1',
      propertyId: propertyId('p1'),
      organizationId: organizationId('o1'),
      userId: userId('u1'),
      source: 'web',
      eventId: 'e1',
      payload: { subject: 'test', from: null, to: null, detail: null } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    })

    expect(insert).toHaveBeenCalled()
  })

  it('demonstrates simulation harness integration (SIM-01)', async () => {
    // Example integration of simulation for test isolation (per ADR 0019)
    const sim = await createSimulationContainer()
    expect(sim).toBeDefined()
    // In real use: use sim.container for wired deps with fakes/clock
  })

  it('removes legacy invitation detail again at the persistence boundary', async () => {
    const marker = 'late-invitee@example.test'
    const insert = vi.fn().mockResolvedValue(undefined)
    const repo = { insert, findDuplicate: vi.fn().mockResolvedValue(null) } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const deps = {
      repo,
      userLookup: { lookup: vi.fn() } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      clock: () => new Date('2026-08-26T00:00:00Z'),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      idGen: () => recentActivityEntryId('act-late-invite'),
    }

    await projectRecentActivity(deps)({
      action: 'invited',
      resourceType: 'member',
      resourceId: 'invitation-1',
      propertyId: null,
      organizationId: organizationId('o1'),
      userId: null,
      source: 'web',
      eventId: 'event-late-invite',
      payload: { subject: 'member', from: null, to: 'member', detail: marker },
    })

    expect(repo.findDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ detail: null }) }),
    )
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ detail: null }) }),
    )
    expect(JSON.stringify(insert.mock.calls)).not.toContain(marker)
  })
})
