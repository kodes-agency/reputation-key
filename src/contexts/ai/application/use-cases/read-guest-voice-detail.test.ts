import { describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  ORGANIZATION_ID,
  END,
  AC,
  id,
  counted,
  analysed,
  harness,
  input,
} from '#/test-fixtures/guest-voice-read.test-fixtures'

describe('readGuestVoiceDetail shares the live page context', () => {
  const detailInput = {
    ...input,
    range: '30d' as const,
    startLocalDate: '2026-07-22',
    endLocalDate: END,
    target: { kind: 'issue' as const, issueId: AC, sense: 'complaint' as const },
  }
  const population = [counted(1, '2026-08-18')]
  const reviews = [analysed(1, '2026-08-18', [{}], { urgentReason: 'health' })]

  it('authorizes a direct application caller before reading any state', async () => {
    const { detail, readMerchantAuthorization } = harness()
    const foreign = buildTestAuthContext({
      organizationId: organizationId('foreign'),
      role: 'AccountAdmin',
    })
    await expect(detail({ ...detailInput, actor: foreign })).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'forbidden',
    })
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
  })
  it('refuses an unassigned PropertyManager before reading any state', async () => {
    const { detail, facts, readTrendPopulation, readMerchantAuthorization } = harness()
    const manager = buildTestAuthContext({
      organizationId: ORGANIZATION_ID,
      role: 'PropertyManager',
    })
    await expect(detail({ ...detailInput, actor: manager })).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'forbidden',
    })
    expect(readMerchantAuthorization).not.toHaveBeenCalled()
    expect(readTrendPopulation).not.toHaveBeenCalled()
    expect(facts.hasV3Analyses).not.toHaveBeenCalled()
    expect(facts.readFacts).not.toHaveBeenCalled()
    expect(facts.readMentionSentences).not.toHaveBeenCalled()
  })
  it.each(['issue', 'topic', 'concern'] as const)(
    'widens the bounded facts read only for issue history (%s)',
    async (kind) => {
      const { detail, facts } = harness({
        populationFor: (request) =>
          request.startLocalDate < '2025-08-21'
            ? { status: 'limit_exceeded' }
            : {
                status: 'complete',
                reviews: Array.from({ length: 60 }, (_, n) =>
                  counted(n + 1, '2026-08-18'),
                ),
              },
        facts: { reviews },
      })
      const target =
        kind === 'topic'
          ? { kind, topic: 'facilities_equipment' as const }
          : kind === 'concern'
            ? { kind, issueId: AC, reason: 'health' as const }
            : detailInput.target
      expect((await detail({ ...detailInput, range: 'auto', target })).status).toBe(
        'drafted',
      )
      expect(facts.readFacts).toHaveBeenCalledWith(expect.anything(), {
        startLocalDate: kind === 'issue' ? '2025-09-01' : '2026-07-22',
        endLocalDate: END,
      })
    },
  )
  it.each([
    { startLocalDate: '2026-02-30' },
    { endLocalDate: '2026-07-21' },
    { startLocalDate: '2025-07-21' },
    { startLocalDate: '2026-07-23' },
    { endLocalDate: '2026-08-19' },
  ])('requires an actual current permitted window (%s)', async (bounds) => {
    const { detail, facts } = harness({ population, facts: { reviews } })
    expect(await detail({ ...detailInput, ...bounds })).toEqual({
      status: 'refresh_required',
    })
    expect(facts.readFacts).not.toHaveBeenCalled()
    expect(facts.readMentionSentences).not.toHaveBeenCalled()
  })
  it('returns a content-free draft and batches sentence pointers for a small-state concern', async () => {
    const { detail, facts } = harness({
      population,
      facts: { reviews },
      sentences: new Map([[`${id(1)}:0`, [2]]]),
    })
    const result = await detail({
      ...detailInput,
      target: { kind: 'concern', issueId: AC, reason: 'health' },
    })
    if (result.status !== 'drafted') throw new Error('expected detail draft')
    expect(result.draft.read.drawer).toMatchObject({
      kind: 'concern',
      reviewCount: 1,
      lastReportedLocalDate: '2026-08-18',
      liveEvidence: [],
    })
    expect(result.draft.evidence[0]?.candidates[0]?.sentenceNumbers).toEqual([2])
    expect(facts.readMentionSentences).toHaveBeenCalledTimes(1)
  })
  it('maps unknown targets to not_found, and gate/refusal outcomes without fake sheets', async () => {
    const missing = harness({ population, facts: { reviews } })
    expect(
      await missing.detail({
        ...detailInput,
        target: {
          kind: 'issue',
          issueId: 'a0000000-0000-4000-8000-000000000002',
          sense: 'praise',
        },
      }),
    ).toEqual({ status: 'not_found' })
    expect(await harness({ capabilities: [] }).detail(detailInput)).toEqual({
      status: 'disabled',
    })
    expect(await harness({ population, facts: null }).detail(detailInput)).toEqual({
      status: 'preparing',
    })
    expect(await harness({ hasV3: false }).detail(detailInput)).toEqual({
      status: 'preparing',
    })
  })
  it('validates an auto fallback against the chosen bounded 90-day window', async () => {
    const { detail } = harness({
      populationFor: (request) =>
        request.startLocalDate < '2026-05-23'
          ? { status: 'limit_exceeded' }
          : { status: 'complete', reviews: population },
      facts: { reviews },
    })
    const result = await detail({
      ...detailInput,
      range: 'auto',
      startLocalDate: '2026-05-23',
    })
    expect(result.status).toBe('drafted')
  })
})
