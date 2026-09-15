import { describe, expect, it, vi } from 'vitest'
import {
  failedSetupTasks,
  mergeSetupResults,
  runSetupPlan,
  type SetupWriteFns,
} from './run-setup-plan'
import type { SetupPlan } from './setup-plan'

const ACKNOWLEDGEMENT = { noticeVersion: 'notice-v2', noticeDigest: 'a'.repeat(64) }

const plan: SetupPlan = {
  aiCapabilities: ['review_analysis', 'reply_drafting'],
  properties: [
    {
      propertyId: 'berlin',
      propertyName: 'Hotel Berlin',
      displayName: 'Hotel Berlin',
      language: 'de-Latn',
      managerIds: ['admin'],
      ai: 'enable',
    },
    {
      propertyId: 'lisbon',
      propertyName: 'Casa Lisboa',
      displayName: null,
      language: null,
      managerIds: ['manager'],
      ai: 'enable',
    },
    {
      propertyId: 'athens',
      propertyName: 'Athens Rooms',
      displayName: 'Athens Rooms Piraeus',
      language: 'en-Latn',
      managerIds: null,
      ai: 'defer',
    },
  ],
}

function fns(overrides: Partial<SetupWriteFns> = {}): SetupWriteFns {
  return {
    enableAi: vi.fn(async () => undefined),
    deferAi: vi.fn(async () => undefined),
    setDisplayName: vi.fn(async () => undefined),
    setLanguage: vi.fn(async () => undefined),
    setManagers: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('running a setup plan', () => {
  it('enables AI for every property in one ceremony and performs every other write', async () => {
    const writes = fns()

    const results = await runSetupPlan(plan, writes, {
      acknowledgement: ACKNOWLEDGEMENT,
      aiIdempotencyKey: 'ceremony-key-0001',
    })

    expect(writes.enableAi).toHaveBeenCalledOnce()
    expect(writes.enableAi).toHaveBeenCalledWith({
      propertyIds: ['berlin', 'lisbon'],
      capabilities: ['review_analysis', 'reply_drafting'],
      acknowledgement: ACKNOWLEDGEMENT,
      idempotencyKey: 'ceremony-key-0001',
    })
    expect(writes.deferAi).toHaveBeenCalledWith({ propertyId: 'athens' })
    expect(writes.setDisplayName).toHaveBeenCalledTimes(2)
    expect(writes.setDisplayName).toHaveBeenCalledWith({
      propertyId: 'athens',
      displayName: 'Athens Rooms Piraeus',
    })
    expect(writes.setLanguage).toHaveBeenCalledTimes(2)
    expect(writes.setManagers).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(9)
    expect(failedSetupTasks(results)).toEqual([])
  })

  it('reports a failed write without stopping the others', async () => {
    const writes = fns({
      enableAi: vi.fn(async () => {
        throw new Error('The AI notice changed. Reload and agree again.')
      }),
      setLanguage: vi.fn(async ({ propertyId }) => {
        if (propertyId === 'athens') throw new Error('Choose a supported language')
      }),
    })

    const results = await runSetupPlan(plan, writes, {
      acknowledgement: ACKNOWLEDGEMENT,
      aiIdempotencyKey: 'ceremony-key-0001',
    })

    expect(failedSetupTasks(results)).toEqual([
      {
        propertyId: 'berlin',
        kind: 'ai',
        outcome: 'failed',
        message: 'The AI notice changed. Reload and agree again.',
      },
      {
        propertyId: 'lisbon',
        kind: 'ai',
        outcome: 'failed',
        message: 'The AI notice changed. Reload and agree again.',
      },
      {
        propertyId: 'athens',
        kind: 'language',
        outcome: 'failed',
        message: 'Choose a supported language',
      },
    ])
    expect(writes.setManagers).toHaveBeenCalledTimes(2)
    expect(writes.deferAi).toHaveBeenCalledOnce()
  })

  it('never enables AI without an acknowledgement of the notice', async () => {
    const writes = fns()

    const results = await runSetupPlan(plan, writes, {
      acknowledgement: null,
      aiIdempotencyKey: 'ceremony-key-0001',
    })

    expect(writes.enableAi).not.toHaveBeenCalled()
    expect(failedSetupTasks(results).map((result) => result.propertyId)).toEqual([
      'berlin',
      'lisbon',
    ])
  })

  it('retries only the failed tasks and merges the outcome over the first run', async () => {
    const first = [
      { propertyId: 'berlin', kind: 'ai', outcome: 'failed', message: 'busy' },
      { propertyId: 'berlin', kind: 'language', outcome: 'saved', message: null },
      { propertyId: 'athens', kind: 'language', outcome: 'failed', message: 'offline' },
    ] as const
    const failed = new Set(
      failedSetupTasks(first).map((task) => `${task.propertyId}:${task.kind}`),
    )
    const writes = fns()

    const retry = await runSetupPlan(plan, writes, {
      acknowledgement: ACKNOWLEDGEMENT,
      aiIdempotencyKey: 'ceremony-key-0001',
      include: (propertyId, kind) => failed.has(`${propertyId}:${kind}`),
    })

    expect(writes.enableAi).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyIds: ['berlin'],
        idempotencyKey: 'ceremony-key-0001',
      }),
    )
    expect(writes.setLanguage).toHaveBeenCalledExactlyOnceWith({
      propertyId: 'athens',
      language: 'en-Latn',
    })
    expect(writes.setManagers).not.toHaveBeenCalled()
    expect(writes.setDisplayName).not.toHaveBeenCalled()
    expect(writes.deferAi).not.toHaveBeenCalled()
    expect(failedSetupTasks(mergeSetupResults(first, retry))).toEqual([])
  })

  it('bounds how many writes run at once', async () => {
    let running = 0
    let peak = 0
    const slow = async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
    }
    const many: SetupPlan = {
      aiCapabilities: [],
      properties: Array.from({ length: 10 }, (_, index) => ({
        propertyId: `p${index}`,
        propertyName: `Property ${index}`,
        displayName: null,
        language: 'en-Latn',
        managerIds: null,
        ai: null,
      })),
    }

    await runSetupPlan(many, fns({ setLanguage: slow }), {
      acknowledgement: null,
      aiIdempotencyKey: 'ceremony-key-0001',
      concurrency: 3,
    })

    expect(peak).toBe(3)
  })
})
