import { describe, it, expect, vi } from 'vitest'

import {
  prepareRecentActivityEntry,
  projectRecentActivity,
  type ProjectRecentActivityInput,
} from './project-recent-activity'
import { activityError } from '../../domain/activity-errors'
import { SYSTEM_USER_ID } from '../../domain/activity-constructors'
import {
  organizationId,
  userId,
  propertyId,
  recentActivityEntryId,
} from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

describe('projectRecentActivity', () => {
  it('inserts the projection through the repository', async () => {
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
        role: 'Member' as Role,
        rawRole: 'Member',
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

  describe('the actor of an entry', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const fact: ProjectRecentActivityInput = {
      action: 'approved',
      resourceType: 'reply',
      resourceId: 'reply-1',
      propertyId: propertyId('p1'),
      organizationId: organizationId('o1'),
      userId: userId('dana'),
      source: 'web',
      eventId: 'event-approved',
      occurredAt: new Date('2026-10-01T10:00:00Z'),
      payload: { subject: 'reply', from: null, to: null, detail: null },
    }
    const depsWith = (lookup: () => Promise<unknown>) => ({
      userLookup: { lookup: vi.fn(lookup) } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      clock: () => new Date('2026-10-01T10:00:05Z'),
      logger,
      idGen: () => recentActivityEntryId('act-actor'),
    })
    const lookupFailure = () =>
      activityError('lookup_failed', 'User lookup failed', { cause: 'statement timeout' })

    // An entry is written once per event, so one that names System for an
    // action a person took can never be corrected by a redelivery.
    it('fails when the actor lookup fails, instead of naming System', async () => {
      const deps = depsWith(() => Promise.reject(lookupFailure()))

      await expect(prepareRecentActivityEntry(deps, fact)).rejects.toMatchObject({
        _tag: 'ActivityError',
        code: 'lookup_failed',
      })
    })

    it('writes nothing when the actor lookup fails, so the delivery is retried', async () => {
      const insert = vi.fn().mockResolvedValue(undefined)
      const repo = { insert, findDuplicate: vi.fn().mockResolvedValue(null) } as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const deps = { ...depsWith(() => Promise.reject(lookupFailure())), repo }

      await expect(projectRecentActivity(deps)(fact)).rejects.toMatchObject({
        code: 'lookup_failed',
      })
      expect(insert).not.toHaveBeenCalled()
    })

    it('names the person the lookup found', async () => {
      const deps = depsWith(async () => ({
        name: 'Dana',
        avatarUrl: null,
        role: 'PropertyManager' as Role,
        rawRole: 'admin',
      }))

      const entry = (await prepareRecentActivityEntry(deps, fact))._unsafeUnwrap()

      expect(entry).toMatchObject({
        actorId: 'dana',
        actorName: 'Dana',
        actorRole: 'PropertyManager',
      })
    })

    it('keeps the answer of the lookup for an actor who is no longer a member', async () => {
      // What the adapter returns for an empty result: not a failure.
      const deps = depsWith(async () => ({
        name: 'System',
        avatarUrl: null,
        role: 'Member' as Role,
        rawRole: 'member',
      }))

      const entry = (await prepareRecentActivityEntry(deps, fact))._unsafeUnwrap()

      expect(entry).toMatchObject({ actorId: 'dana', actorName: 'System' })
    })

    it('attributes a fact that names no actor to the system user', async () => {
      const deps = depsWith(() => Promise.reject(lookupFailure()))

      const entry = (
        await prepareRecentActivityEntry(deps, { ...fact, userId: null })
      )._unsafeUnwrap()

      expect(entry).toMatchObject({ actorId: SYSTEM_USER_ID, actorName: 'System' })
      expect(deps.userLookup.lookup).not.toHaveBeenCalled()
    })
  })
})
