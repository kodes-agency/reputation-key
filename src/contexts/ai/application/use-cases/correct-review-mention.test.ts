import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type {
  AiMentionCorrectionStorePort,
  ApplyMentionCorrectionInput,
  ClearMentionCorrectionInput,
} from '../ports/ai-mention-correction-store.port'
import {
  createCorrectReviewMention,
  type CorrectReviewMentionDependencies,
  type CorrectReviewMentionInput,
  type MentionCorrectionAction,
} from './correct-review-mention'

const ORGANIZATION_ID = organizationId('11111111-1111-4111-8111-111111111111')
const PROPERTY_ID = propertyId('22222222-2222-4222-8222-222222222222')
const MANAGER = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  userId: userId('33333333-3333-4333-8333-333333333333'),
  role: 'AccountAdmin',
})
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)

function harness(
  options: Readonly<{
    capabilities?: readonly string[]
    grants?: readonly (typeof PROPERTY_ID)[]
    applied?: Awaited<ReturnType<AiMentionCorrectionStorePort['apply']>>
    cleared?: Awaited<ReturnType<AiMentionCorrectionStorePort['clear']>>
  }> = {},
) {
  const apply = vi.fn(
    async (_input: ApplyMentionCorrectionInput) =>
      options.applied ?? ({ status: 'applied', mentionOrdinals: [2] } as const),
  )
  const clear = vi.fn(
    async (_input: ClearMentionCorrectionInput) =>
      options.cleared ?? ({ status: 'cleared', mentionOrdinals: [2] } as const),
  )
  const readMerchantAuthorization = vi.fn(async () => ({
    state: 'enabled',
    authorizationLineageId: 'lineage-1',
    capabilities: options.capabilities ?? ['review_analysis'],
    authorizedSourceEpoch: 7,
    capabilityEpochs: { review_analysis: { epoch: 4 }, property_trends: { epoch: 9 } },
  }))
  const correct = createCorrectReviewMention({
    propertyAccess: async () => options.grants ?? [],
    authorization: {
      readMerchantAuthorization,
    } as unknown as CorrectReviewMentionDependencies['authorization'],
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available',
        profile: { profileVersion: 11, timezone: 'Asia/Tokyo' },
      })),
    } as unknown as CorrectReviewMentionDependencies['processingProfiles'],
    corrections: { apply, clear },
    nowEpochMillis: () => NOW,
  })
  return { correct, apply, clear, readMerchantAuthorization }
}

function input(
  action: MentionCorrectionAction,
  over: Partial<CorrectReviewMentionInput> = {},
): CorrectReviewMentionInput {
  return {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    reviewId: reviewId('44444444-4444-4444-8444-444444444444'),
    sourceEpoch: 7,
    sourceRevision: 3,
    analysisSequence: 9,
    mentionOrdinal: 2,
    action,
    actor: MANAGER,
    ...over,
  }
}

describe('correctReviewMention authorization and gates', () => {
  const forbidden = { _tag: 'AiError', code: 'forbidden' }

  it('refuses a manager with no grant on the Property before anything is read or written', async () => {
    const { correct, apply, readMerchantAuthorization } = harness({
      grants: [propertyId('22222222-2222-4222-8222-222222222223')],
    })
    const outsider = buildTestAuthContext({
      organizationId: ORGANIZATION_ID,
      role: 'PropertyManager',
    })

    await expect(
      correct(input({ kind: 'remove_topic' }, { actor: outsider })),
    ).rejects.toMatchObject(forbidden)
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses a reader of another Organization', async () => {
    const { correct, apply } = harness()
    const foreign = buildTestAuthContext({
      organizationId: organizationId('11111111-1111-4111-8111-111111111112'),
      role: 'AccountAdmin',
    })

    await expect(
      correct(input({ kind: 'remove_topic' }, { actor: foreign })),
    ).rejects.toMatchObject(forbidden)
    expect(apply).not.toHaveBeenCalled()
  })

  it('answers disabled, writing nothing, when review analysis is not authorized', async () => {
    const { correct, apply, clear } = harness({ capabilities: ['property_trends'] })

    await expect(correct(input({ kind: 'remove_topic' }))).resolves.toEqual({
      status: 'disabled',
    })
    await expect(correct(input({ kind: 'undo' }))).resolves.toEqual({
      status: 'disabled',
    })
    expect(apply).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('answers not found for a review whose source has moved on, writing nothing', async () => {
    const { correct, apply } = harness()

    await expect(
      correct(input({ kind: 'remove_topic' }, { sourceEpoch: 6 })),
    ).resolves.toEqual({ status: 'not_found' })
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('correctReviewMention writes', () => {
  it('sets a topic aside under the fences of the Property’s authorization', async () => {
    const { correct, apply } = harness({
      applied: { status: 'applied', mentionOrdinals: [1, 2] },
    })

    await expect(correct(input({ kind: 'remove_topic' }))).resolves.toEqual({
      status: 'applied',
      mentionOrdinals: [1, 2],
    })
    expect(apply).toHaveBeenCalledWith({
      key: {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: '44444444-4444-4444-8444-444444444444',
        sourceEpoch: 7,
        sourceRevision: 3,
        analysisSequence: 9,
      },
      fences: { reviewAnalysisEpoch: 4, propertyProfileVersion: 11 },
      mentionOrdinal: 2,
      command: { kind: 'remove_topic' },
      correctedBy: MANAGER.userId,
      correctedAt: new Date(NOW),
    })
  })

  it('says a complaint is no problem', async () => {
    const { correct, apply } = harness()

    await correct(input({ kind: 'not_a_problem' }))

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ command: { kind: 'not_a_problem' } }),
    )
  })

  it('hands on what the store says it cannot do', async () => {
    const { correct } = harness({ applied: { status: 'not_applicable' } })

    await expect(correct(input({ kind: 'not_a_problem' }))).resolves.toEqual({
      status: 'not_applicable',
    })
  })

  it('gives a mention back with an undo, and says so when there was nothing to give back', async () => {
    const { correct, clear } = harness({ cleared: { status: 'not_found' } })

    await expect(correct(input({ kind: 'undo' }))).resolves.toEqual({
      status: 'not_found',
    })
    expect(clear).toHaveBeenCalledWith({
      key: expect.objectContaining({ analysisSequence: 9 }),
      fences: { reviewAnalysisEpoch: 4, propertyProfileVersion: 11 },
      mentionOrdinal: 2,
    })
  })

  it('reports the mentions an undo gave back', async () => {
    const { correct } = harness({
      cleared: { status: 'cleared', mentionOrdinals: [0, 1] },
    })

    await expect(correct(input({ kind: 'undo' }))).resolves.toEqual({
      status: 'cleared',
      mentionOrdinals: [0, 1],
    })
  })
})

describe('correctReviewMention a changed cause', () => {
  const change = (thing: string | null, issue: string | null) =>
    input({ kind: 'change_cause', thing, issue })

  it('writes the phrases as the stored contract holds them: lowercase, one space between words', async () => {
    const { correct, apply } = harness()

    await correct(change('  Air  CONDITIONING ', 'Not Working'))

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          kind: 'change_cause',
          thing: 'air conditioning',
          issue: 'not working',
        },
      }),
    )
  })

  it('lets a topic name no thing, only what was wrong', async () => {
    const { correct, apply } = harness()

    await correct(change(null, 'unreliable'))
    await correct(change('   ', 'unreliable'))

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: { kind: 'change_cause', thing: null, issue: 'unreliable' },
      }),
    )
  })

  it.each([
    ['a thing with nothing said of it', 'lift', null],
    ['neither phrase', null, null],
    ['empty phrases', '', '  '],
    ['more than three words', 'the very old lift', 'broke'],
    ['a name or a number', 'room 12', 'dirty'],
    ['punctuation inside', 'lift, again', 'broke'],
  ] as const)('refuses %s, writing nothing', async (_name, thing, issue) => {
    const { correct, apply } = harness()

    await expect(correct(change(thing, issue))).resolves.toEqual({
      status: 'invalid_cause',
    })
    expect(apply).not.toHaveBeenCalled()
  })
})
