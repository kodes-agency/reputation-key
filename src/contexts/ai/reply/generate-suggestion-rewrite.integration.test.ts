import {
  INPUT,
  NOW,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
} from '#/contexts/ai/infrastructure/testing/reply-handler.test-fixtures'
import {
  REJECTED_V2_OUTPUT,
  createV2Harness,
} from '#/contexts/ai/infrastructure/testing/reply-rewrite-handler.test-fixtures'
import { userId } from '#/shared/domain/ids'
import { describe, expect, it, vi } from 'vitest'

import { replyProgressResponse } from '../server/reply-progress-stream.server'
describe('dark reply v2 rewrite orchestration', () => {
  it.each(['refused', 'busy'] as const)(
    'writes nothing before a %s admission',
    async (outcome) => {
      const h = await createV2Harness(['accepted'])
      const reserveFrame = vi.spyOn(h.dependencies.replyVoices!, 'resolveV2Frame')
      if (outcome === 'refused') await h.base.persistence.grant({ state: 'disabled' })
      else
        vi.mocked(h.base.mocks.acquire).mockResolvedValue({
          ok: false,
          code: 'admission_busy',
          retryAfterEpochMillis: NOW + 10_000,
        })
      expect(await h.generate(INPUT)).toMatchObject({
        status: 'unavailable',
        code: outcome === 'refused' ? 'not_authorized' : 'busy',
      })
      expect(reserveFrame).not.toHaveBeenCalled()
      expect(h.claim).not.toHaveBeenCalled()
      expect(h.claimExecution).not.toHaveBeenCalled()
      expect(h.generateReply).not.toHaveBeenCalled()
      expect(await h.storedOperations()).toHaveLength(0)
    },
  )

  it('releases admission when the frame cannot be reserved', async () => {
    const h = await createV2Harness(['accepted'])
    vi.spyOn(h.dependencies.replyVoices!, 'resolveV2Frame').mockResolvedValue(null)
    expect(await h.generate(INPUT)).toMatchObject({
      status: 'unavailable',
      code: 'policy_unavailable',
    })
    expect(h.base.mocks.acquire).toHaveBeenCalledTimes(1)
    expect(h.base.mocks.release).toHaveBeenCalledTimes(1)
    expect(h.claim).not.toHaveBeenCalled()
  })

  it('makes one separately admitted call for an accepted body', async () => {
    const h = await createV2Harness(['accepted'])
    expect((await h.generate(INPUT)).status).toBe('ready')
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.base.mocks.acquire).toHaveBeenCalledTimes(1)
    expect(h.base.mocks.release).toHaveBeenCalledTimes(1)
    expect([...h.charges.values()]).toEqual([1])
    expect(h.generateReply.mock.calls[0]![0].source.sentences).toEqual([
      { number: 1, text: 'We waited a long time for the room to be ready.' },
    ])
  })
  it('admits, permits and charges a distinct child once and delivers only the accepted result', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    expect((await h.generate(INPUT)).status).toBe('ready')
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect([...h.charges.values()]).toEqual([1, 1])
    expect(h.base.mocks.acquire).toHaveBeenCalledTimes(2)
    expect(h.base.mocks.release).toHaveBeenCalledTimes(2)
    const [parent, child] = h.generateReply.mock.calls.map(([request]) => request)
    expect(child!.operationId).not.toBe(parent!.operationId)
    expect(child!.permitId).not.toBe(parent!.permitId)
    expect(child!.binding.replyDraftingV2).toMatchObject({
      parentOperationId: parent!.operationId,
      rewriteOrdinal: 1,
      rewriteIssues: expect.arrayContaining(['invitation']),
      options: parent!.binding.replyDraftingV2!.options,
    })
    expect(h.base.mocks.settleEphemeralReply).toHaveBeenCalledTimes(1)
  })
  it('says the draft failed, not that others are busy, when its rewrite finds the lane full', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    vi.mocked(h.base.mocks.acquire)
      .mockResolvedValueOnce({
        ok: true,
        admissionId: 'first-admission',
        expiresAtEpochMillis: NOW + 90_000,
      })
      .mockResolvedValue({
        ok: false,
        code: 'admission_busy',
        retryAfterEpochMillis: NOW + 60_000,
      })
    expect(await h.generate(INPUT)).toMatchObject({
      status: 'unavailable',
      code: 'provider_unavailable',
    })
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })
  it('keeps actual rejected body and avoidance values out of rewrite, logs, events and stored rows', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => {}),
    )
    try {
      const result = await h.generate(INPUT)
      expect(result.status).toBe('ready')
      expect(h.generateReply).toHaveBeenCalledTimes(2)
      expect(h.refusals).toContainEqual({
        route: 'reply-suggestion',
        reason: 'avoidance',
      })
      const surfaces = {
        rewrite: h.generateReply.mock.calls[1]![0],
        logs: [
          stdout.mock.calls,
          stderr.mock.calls,
          ...consoleSpies.map((spy) => spy.mock.calls),
        ],
        events: h.refusals,
        persisted: [
          await h.storedOperations(),
          h.base.mocks.settleEphemeralReply.mock.calls,
        ],
        delivered: result,
      }
      for (const surface of Object.values(surfaces)) {
        const serialized = JSON.stringify(surface)
        for (const secret of [
          REJECTED_V2_OUTPUT.replyText,
          ...REJECTED_V2_OUTPUT.avoidTerms,
        ])
          expect(serialized).not.toContain(secret)
      }
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
      for (const spy of consoleSpies) spy.mockRestore()
    }
  })

  it('waits for the parent admission release before admitting the child', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    let completeRelease!: () => void
    const parentRelease = new Promise<void>((resolve) => {
      completeRelease = resolve
    })
    h.base.mocks.release.mockImplementationOnce(async () => parentRelease)
    const result = h.generate(INPUT)
    await vi.waitFor(() => expect(h.base.mocks.release).toHaveBeenCalledTimes(1))
    try {
      expect(h.base.mocks.acquire).toHaveBeenCalledTimes(1)
    } finally {
      completeRelease()
    }
    expect((await result).status).toBe('ready')
    expect(h.base.mocks.acquire).toHaveBeenCalledTimes(2)
  })
  it('refuses a second hard failure and never makes a third call, including a replay', async () => {
    const h = await createV2Harness(['hard', 'hard', 'accepted'])
    expect((await h.generate(INPUT)).status).toBe('unavailable')
    expect((await h.generate(INPUT)).status).toBe('unavailable')
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect([...h.charges.values()]).toEqual([1, 1])
    expect(h.base.mocks.settleEphemeralReply).not.toHaveBeenCalled()
  })
  it('shares concurrent claims so that only one rewrite can execute', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    const results = await Promise.all([h.generate(INPUT), h.generate(INPUT)])
    expect(results.filter((result) => result.status === 'ready')).toHaveLength(2)
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect([...h.charges.values()]).toEqual([1, 1])
    expect(await h.storedOperations()).toHaveLength(2)
  })
  it.each(['source', 'consent', 'voice', 'reply_revision'] as const)(
    'rechecks %s after settlement before delivery',
    async (change) => {
      const h = await createV2Harness(['accepted'])
      vi.mocked(h.dependencies.outputs.settleEphemeralReply).mockImplementation(
        async () => {
          if (change === 'source')
            vi.mocked(h.base.dependencies.reviewSources.assertCurrent).mockResolvedValue({
              status: 'source_revision_changed',
            })
          if (change === 'consent') await h.base.persistence.grant({ state: 'disabled' })
          if (change === 'voice')
            vi.mocked(
              h.base.dependencies.replyVoices!.resolveLocalFrame,
            ).mockResolvedValue(null)
          if (change === 'reply_revision')
            vi.mocked(
              h.base.dependencies.reviewSources.readReplyStateRevision,
            ).mockResolvedValue(4)
          return true
        },
      )
      expect((await h.generate(INPUT)).status).toBe('unavailable')
      expect(h.base.mocks.markDelivered).not.toHaveBeenCalled()
      expect(h.generateReply).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['refused', 'ambiguous', 'scanner_unavailable'] as const)(
    'does not rewrite %s',
    async (outcome) => {
      const h = await createV2Harness([outcome, 'accepted'])
      expect((await h.generate(INPUT)).status).toBe('unavailable')
      expect(h.generateReply).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['source', 'consent', 'voice', 'reply_revision'] as const)(
    'refuses a %s change between calls',
    async (change) => {
      const h = await createV2Harness(['hard', 'accepted'], async (base) => {
        if (change === 'source')
          vi.mocked(base.dependencies.reviewSources.assertCurrent).mockResolvedValue({
            status: 'source_revision_changed',
          })
        if (change === 'consent') await base.persistence.grant({ state: 'disabled' })
        if (change === 'voice')
          vi.mocked(base.dependencies.replyVoices!.resolveLocalFrame).mockResolvedValue({
            prefix: '',
            suffix: '',
            voiceDigest: 'b'.repeat(64),
            reviewerDisplayName: null,
            contact: null,
            signerName: null,
            signerTitle: null,
            businessName: 'Example Hotel',
          })
        if (change === 'reply_revision')
          vi.mocked(
            base.dependencies.reviewSources.readReplyStateRevision,
          ).mockResolvedValue(4)
      })
      expect((await h.generate(INPUT)).status).toBe('unavailable')
      expect(h.generateReply).toHaveBeenCalledTimes(1)
      expect(h.base.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    },
  )
})

describe('dark v2 background drafting', () => {
  it('uses only background admission, including the independently charged rewrite', async () => {
    const h = await createV2Harness(['hard', 'accepted'])
    const progress = vi.fn()
    expect(
      (await h.generate({ ...INPUT, intent: 'background', onProgress: progress })).status,
    ).toBe('ready')
    expect(
      vi.mocked(h.base.mocks.acquire).mock.calls.map(([request]) => request.lane),
    ).toEqual(['background', 'background'])
    expect(h.base.mocks.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundDraftActorUserId: INPUT.actorUserId,
      }),
    )
    expect(progress.mock.calls.map(([event]) => event.step)).toEqual([
      'reading',
      'rewording',
    ])
    expect(h.generateReply).toHaveBeenCalledTimes(2)
  })
  it('defers busy background work immediately without claiming or reserving anything', async () => {
    const h = await createV2Harness(['accepted'])
    vi.mocked(h.base.mocks.acquire).mockResolvedValue({
      ok: false,
      code: 'admission_busy',
      retryAfterEpochMillis: NOW + 1000,
    })
    const response = replyProgressResponse(
      (onProgress) => h.generate({ ...INPUT, intent: 'background', onProgress }),
      'background',
    )
    expect(JSON.parse((await response.text()).trim())).toEqual({
      step: 'deferred',
      retryAfterEpochMillis: NOW + 1000,
      sequence: 1,
    })
    expect(h.base.mocks.acquire).toHaveBeenCalledTimes(1)
    expect(h.claim).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('never prefetches when the authoritative local/Google reply read is answered', async () => {
    const h = await createV2Harness(['accepted'])
    vi.mocked(h.dependencies.reviewSources.hasCurrentReply).mockResolvedValue(true)
    await h.generate({ ...INPUT, intent: 'background' })
    expect(h.base.mocks.acquire).not.toHaveBeenCalled()
    expect(h.claim).not.toHaveBeenCalled()
  })
  it.each(['no_text', 'source_changed', 'consent', 'voice'] as const)(
    'performs no background provider work with %s',
    async (condition) => {
      const h = await createV2Harness(['accepted'])
      if (condition === 'no_text')
        vi.spyOn(h.dependencies.reviewSources, 'readForAi').mockResolvedValue({
          status: 'available',
          observation: {
            kind: 'review',
            organizationId: ORGANIZATION_ID,
            propertyId: PROPERTY_ID,
            reviewId: REVIEW_ID,
            text: null,
            rating: 5,
            languageCode: 'en-US',
            reviewedAtEpochMillis: NOW - 1000,
            contentExpiresAtEpochMillis: NOW + 60000,
            sourceEpoch: 2,
            sourceRevision: 5,
            analysisSequence: 1,
          },
        })
      if (condition === 'source_changed')
        vi.spyOn(h.dependencies.reviewSources, 'readForAi').mockResolvedValue({
          status: 'source_revision_changed',
        })
      if (condition === 'consent') await h.base.persistence.grant({ state: 'disabled' })
      if (condition === 'voice')
        vi.spyOn(h.dependencies.replyVoices!, 'resolveV2Frame').mockResolvedValue(null)
      expect((await h.generate({ ...INPUT, intent: 'background' })).status).toBe(
        'unavailable',
      )
      expect(h.generateReply).not.toHaveBeenCalled()
      expect(h.claim).not.toHaveBeenCalled()
    },
  )
  it('joins Strict Mode duplicates and explicit reveal, replaying content-free progress', async () => {
    const h = await createV2Harness(['accepted'])
    const explicit = vi.fn()
    const results = await Promise.all([
      h.generate({ ...INPUT, intent: 'background' }),
      h.generate({ ...INPUT, intent: 'explicit', onProgress: explicit }),
    ])
    expect(results[0]).toEqual(results[1])
    expect(h.generateReply).toHaveBeenCalledOnce()
    expect(h.base.mocks.acquire).toHaveBeenCalledOnce()
    expect(vi.mocked(h.base.mocks.acquire).mock.calls[0]![0].lane).toBe('background')
    expect(explicit).toHaveBeenCalledWith({
      step: 'reading',
      frame: { prefix: '', suffix: '' },
      reviewTextDigest:
        '71b1b8c0a0be16aa23b72385f5052adcf9449f62c76d8b7e46f219397b9f6718',
    })
  })
  it('refuses a changed request under the same key and does not share between actors', async () => {
    const h = await createV2Harness(['accepted'])
    const results = await Promise.all([
      h.generate(INPUT),
      h.generate({ ...INPUT, tone: 'casual' }),
    ])
    expect(results[1]).toMatchObject({
      status: 'unavailable',
      code: 'policy_unavailable',
    })
    expect(h.generateReply).toHaveBeenCalledOnce()
    const perActor = await createV2Harness(['accepted', 'accepted'])
    await Promise.all([
      perActor.generate(INPUT),
      perActor.generate({ ...INPUT, actorUserId: userId('different-manager') }),
    ])
    // Both actors reach the durable claim, whose actor-scoped idempotency protects their provenance.
    expect(perActor.claim).toHaveBeenCalledTimes(2)
    expect(
      perActor.claim.mock.calls.map(([request]) => request.identity.actorId),
    ).toEqual([INPUT.actorUserId, 'different-manager'])
  })
})

it.each(['cancel', 'abort'] as const)(
  'settles the real v2 use case once after browser %s during provider work',
  async (disconnect) => {
    const h = await createV2Harness(['accepted'])
    const browser = new AbortController()
    let finish!: () => void
    const providerGate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const original = h.generateReply.getMockImplementation()!
    h.generateReply.mockImplementation(async (request, signal, onProgress) => {
      onProgress?.({ step: 'thinking' })
      await providerGate
      expect(signal.aborted).toBe(false)
      return original(request, signal, onProgress)
    })
    const completed = vi.fn()
    const response = replyProgressResponse(
      async (onProgress) => {
        const result = await h.generate({
          ...INPUT,
          onProgress,
          variation: undefined,
          length: undefined,
          maxWords: undefined,
        })
        completed(result)
        return result
      },
      'explicit',
      browser.signal,
    )
    const reader = response.body!.getReader()
    await vi.waitFor(() => expect(h.generateReply).toHaveBeenCalledOnce())
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('reading')
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('thinking')
    if (disconnect === 'cancel') await reader.cancel()
    else browser.abort()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(h.base.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() =>
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready' }),
      ),
    )
    expect(h.base.mocks.settleEphemeralReply).toHaveBeenCalledOnce()
    expect(h.dependencies.admission.release).toHaveBeenCalledOnce()
    expect(h.base.mocks.markDelivered).toHaveBeenCalledOnce()
    expect(h.generateReply).toHaveBeenCalledOnce()
    expect([...h.charges.values()]).toEqual([1])
    expect(await reader.read()).toEqual({ done: true, value: undefined })
  },
)

it('does not dispatch background work when Google replies during admission', async () => {
  const h = await createV2Harness(['accepted'])
  const acquire = h.base.mocks.acquire
  const original = vi.mocked(acquire).getMockImplementation()!
  vi.mocked(acquire).mockImplementation(async (input) => {
    vi.mocked(h.dependencies.reviewSources.hasCurrentReply).mockResolvedValue(true)
    return original(input)
  })
  expect(await h.generate({ ...INPUT, intent: 'background' })).toMatchObject({
    status: 'unavailable',
    code: 'source_changed',
  })
  expect(h.generateReply).not.toHaveBeenCalled()
})

it('drops a background result when Google replies during provider work', async () => {
  const h = await createV2Harness(['accepted'], () => {
    vi.mocked(h.dependencies.reviewSources.hasCurrentReply).mockResolvedValue(true)
  })
  expect(await h.generate({ ...INPUT, intent: 'background' })).toMatchObject({
    status: 'unavailable',
    code: 'source_changed',
  })
  expect(h.generateReply).toHaveBeenCalledOnce()
  expect(h.base.mocks.settleEphemeralReply).not.toHaveBeenCalled()
})

it.each(['voice', 'language', 'profile'] as const)(
  'does not join an in-flight draft after its %s identity changed',
  async (changed) => {
    const h = await createV2Harness(['accepted'])
    vi.mocked(h.base.mocks.readDefaultReplyLanguage).mockResolvedValue('en-Latn')
    let finish!: () => void
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    const provider = h.generateReply.getMockImplementation()!
    h.generateReply.mockImplementation(async (...args) => {
      await held
      return provider(...args)
    })
    const request = { ...INPUT, targetLanguage: { kind: 'property_default' as const } }
    const running = h.generate(request)
    await vi.waitFor(() => expect(h.generateReply).toHaveBeenCalledOnce())
    if (changed === 'voice')
      vi.spyOn(h.dependencies.replyVoices!, 'resolveLocalFrame').mockResolvedValue(null)
    if (changed === 'language')
      vi.mocked(h.base.mocks.readDefaultReplyLanguage).mockResolvedValue('es-Latn')
    if (changed === 'profile')
      vi.spyOn(h.dependencies.processingProfiles, 'readForAi').mockResolvedValue({
        status: 'policy_unavailable',
      })
    expect(await h.generate(request)).toMatchObject({
      status: 'unavailable',
      code: 'source_changed',
    })
    expect(h.generateReply).toHaveBeenCalledOnce()
    finish()
    await running
  },
)

it('lets concurrent explicit joins take interactive capacity after a zero-work background deferral', async () => {
  const h = await createV2Harness(['accepted'])
  const original = vi.mocked(h.base.mocks.acquire).getMockImplementation()!
  vi.mocked(h.base.mocks.acquire).mockImplementation(async (input) =>
    input.lane === 'background'
      ? { ok: false, code: 'admission_busy', retryAfterEpochMillis: NOW + 1000 }
      : original(input),
  )
  const [background, explicit, duplicate] = await Promise.all([
    h.generate({ ...INPUT, intent: 'background' }),
    h.generate({ ...INPUT, intent: 'explicit' }),
    h.generate({ ...INPUT, intent: 'explicit' }),
  ])
  expect(background).toMatchObject({ status: 'unavailable', code: 'busy' })
  expect(explicit.status).toBe('ready')
  expect(duplicate).toEqual(explicit)
  expect(vi.mocked(h.base.mocks.acquire).mock.calls.map(([input]) => input.lane)).toEqual(
    ['background', 'interactive'],
  )
  expect(h.generateReply).toHaveBeenCalledOnce()
  expect(h.claim).toHaveBeenCalledOnce()
})
