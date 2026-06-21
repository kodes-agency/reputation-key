// Activity context — insert-activity-log use case tests
// Pure unit tests with mock deps — no DB needed.

import { describe, it, expect, vi } from 'vitest'
import { insertActivityLog } from './insert-activity-log'
import type { ActivityRepository } from '../../ports/activity-repository.port'
import type { UserLookupPort } from '../../ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { activityLogId, organizationId, userId, propertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')
const ORG = organizationId('org-1')
const USER = userId('user-1')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')

function createMockDeps(overrides?: {
  duplicate?: boolean
  user?: { name: string; avatarUrl: string | null; role: string } | null
  insertError?: Error
}) {
  const repo = {
    findDuplicate: vi.fn(async () => overrides?.duplicate ?? false),
    insert: vi.fn(async () => {
      if (overrides?.insertError) throw overrides.insertError
    }),
    findByOrg: vi.fn(async () => []),
    findByResource: vi.fn(async () => []),
  } as unknown as ActivityRepository

  const userLookup = {
    lookup: vi.fn(async () => {
      if (overrides?.user === null) throw new Error('User not found')
      return (
        overrides?.user ?? {
          name: 'Jane Doe',
          avatarUrl: null,
          role: 'PropertyManager',
        }
      )
    }),
  } as unknown as UserLookupPort

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as LoggerPort

  return {
    repo,
    userLookup,
    logger,
    clock: () => FIXED_TIME,
    idGen: () => activityLogId('act-001'),
  }
}

const validInput = {
  action: 'created' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  propertyId: PROP,
  organizationId: ORG,
  userId: USER,
  source: 'web' as const,
  payload: { subject: 'inbox_item', from: null, to: null, detail: null },
}

describe('insertActivityLog', () => {
  it('inserts an activity log entry', async () => {
    const deps = createMockDeps()
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    expect(deps.repo.insert).toHaveBeenCalledTimes(1)
  })

  it('skips insert when duplicate exists', async () => {
    const deps = createMockDeps({ duplicate: true })
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    expect(deps.repo.insert).not.toHaveBeenCalled()
  })

  it('resolves actor info from user lookup', async () => {
    const deps = createMockDeps({
      user: {
        name: 'John Smith',
        avatarUrl: 'https://example.com/a.png',
        role: 'AccountAdmin',
      },
    })
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    expect(deps.userLookup.lookup).toHaveBeenCalledWith(USER as string, ORG as string)
    expect(deps.repo.insert).toHaveBeenCalledTimes(1)
    const inserted = (deps.repo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(inserted.actorName).toBe('John Smith')
    expect(inserted.actorAvatarUrl).toBe('https://example.com/a.png')
    expect(inserted.actorRole).toBe('AccountAdmin')
  })

  it('falls back to system defaults when user lookup fails', async () => {
    const deps = createMockDeps({ user: null })
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    expect(deps.logger.warn).toHaveBeenCalled()
    expect(deps.repo.insert).toHaveBeenCalledTimes(1)
    const inserted = (deps.repo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(inserted.actorName).toBe('System')
    expect(inserted.actorRole).toBe('Staff')
  })

  it('uses system defaults when userId is null', async () => {
    const deps = createMockDeps()
    const useCase = insertActivityLog(deps)

    await useCase({ ...validInput, userId: null })

    expect(deps.userLookup.lookup).not.toHaveBeenCalled()
    const inserted = (deps.repo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(inserted.actorName).toBe('System')
  })

  it('uses clock() for createdAt', async () => {
    const deps = createMockDeps()
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    const inserted = (deps.repo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(inserted.createdAt).toEqual(FIXED_TIME)
  })

  it('re-throws on insert failure (for BullMQ retry)', async () => {
    const deps = createMockDeps({ insertError: new Error('DB down') })
    const useCase = insertActivityLog(deps)

    await expect(useCase(validInput)).rejects.toThrow('DB down')
    expect(deps.logger.error).toHaveBeenCalled()
  })

  it('passes idempotency dedup fields to findDuplicate', async () => {
    const deps = createMockDeps()
    const useCase = insertActivityLog(deps)

    await useCase(validInput)

    expect(deps.repo.findDuplicate).toHaveBeenCalledWith({
      action: 'created',
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      organizationId: ORG,
      payload: validInput.payload,
    })
  })
})
