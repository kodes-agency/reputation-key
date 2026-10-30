import { describe, expect, it } from 'vitest'
import {
  prepareEvaluationItem,
  type EvaluationRequest,
} from './review-analysis-v3-provider'
import {
  EvaluationProviderError,
  FAKE_GOLD_PROVIDER_ID,
  createAnswerFileProvider,
  createGoldEchoProvider,
  parseAnswerRows,
  resolveProviders,
} from './review-analysis-v3-providers'
import {
  buildTestSet,
  parseEvaluationItems,
  parseGoldLabels,
} from './review-analysis-v3-testset'
import { item } from './review-analysis-v3.test-fixtures'

const ITEM_LINE = JSON.stringify(item({ id: 'cx-9001' }))
const GOLD_LINE = JSON.stringify({
  id: 'cx-9001',
  sentiment: 'negative',
  mentions: [
    {
      topic: 'facilities_equipment',
      polarity: 'negative',
      strength: 'clear',
      thing: 'air conditioning',
      issue: 'not working',
      sentences: [1],
      names_person: null,
    },
  ],
  urgent: null,
  gold_source: 'round1_both_families',
})
const testSet = buildTestSet(
  parseEvaluationItems('items.jsonl', ITEM_LINE),
  parseGoldLabels('gold.jsonl', GOLD_LINE),
)

function requestFor(itemId: string): EvaluationRequest {
  const one = prepareEvaluationItem(item({ id: itemId }))
  if (one.status !== 'prepared') throw new Error('the test item should be prepared')
  return one.request
}

describe('createGoldEchoProvider', () => {
  const provider = createGoldEchoProvider(testSet.scored)

  it('answers a review with its gold label and nothing else', async () => {
    const outcome = await provider.analyze(requestFor('cx-9001'))

    expect(provider.id).toBe(FAKE_GOLD_PROVIDER_ID)
    expect(outcome).toMatchObject({ status: 'answered' })
    expect(
      outcome.status === 'answered' && Object.keys(outcome.answer as object),
    ).toEqual(['sentiment', 'mentions', 'urgent'])
  })

  it('hands out a copy, so a run cannot change the next one', async () => {
    const first = await provider.analyze(requestFor('cx-9001'))
    if (first.status === 'answered')
      (first.answer as { sentiment: string }).sentiment = 'positive'

    const second = await provider.analyze(requestFor('cx-9001'))

    expect(
      second.status === 'answered' && (second.answer as { sentiment: string }).sentiment,
    ).toBe('negative')
  })

  it('fails a review it has no label for', async () => {
    expect(await provider.analyze(requestFor('cx-0000'))).toMatchObject({
      status: 'failed',
    })
  })
})

describe('parseAnswerRows', () => {
  it('reads a file of recorded answers by id', () => {
    const rows = parseAnswerRows(
      'answers.jsonl',
      `${JSON.stringify({ id: 'cx-9001', answer: { sentiment: 'neutral' } })}\n\n`,
    )

    expect(rows.get('cx-9001')).toEqual({ sentiment: 'neutral' })
  })

  it('names the line of every problem and none of the content', () => {
    const attempt = () =>
      parseAnswerRows(
        'answers.jsonl',
        [
          'oops',
          JSON.stringify({ id: 'cx-9001', answer: 1 }),
          JSON.stringify({ answer: 3 }),
        ].join('\n'),
      )

    expect(attempt).toThrow(EvaluationProviderError)
    expect(attempt).toThrow(/answers\.jsonl:1: not JSON/u)
    expect(attempt).toThrow(/answers\.jsonl:3: id/u)
  })

  it('refuses a review answered twice', () => {
    const attempt = () =>
      parseAnswerRows(
        'answers.jsonl',
        [
          JSON.stringify({ id: 'cx-9001', answer: 1 }),
          JSON.stringify({ id: 'cx-9001', answer: 2 }),
        ].join('\n'),
      )

    expect(attempt).toThrow(EvaluationProviderError)
    expect(attempt).toThrow(/answers\.jsonl: cx-9001: the id is answered twice/u)
  })
})

describe('createAnswerFileProvider', () => {
  it('replays the recorded answer of a review and fails one it has none for', async () => {
    const provider = createAnswerFileProvider(
      'run-1.jsonl',
      new Map([['cx-9001', { sentiment: 'neutral' }]]),
    )

    expect(provider.id).toBe('answers:run-1.jsonl')
    expect(await provider.analyze(requestFor('cx-9001'))).toMatchObject({
      status: 'answered',
      answer: { sentiment: 'neutral' },
    })
    expect(await provider.analyze(requestFor('cx-0000'))).toMatchObject({
      status: 'failed',
    })
  })
})

describe('resolveProviders', () => {
  const readFile = (path: string) => {
    if (path === 'dir/run-1.jsonl') return JSON.stringify({ id: 'cx-9001', answer: {} })
    throw new Error(`unexpected read of ${path}`)
  }
  const context = { testSet, readFile }

  it('names the fake and a file of recorded answers', () => {
    const providers = resolveProviders('fake-gold, answers:dir/run-1.jsonl', context)

    expect(providers.map((provider) => provider.id)).toEqual([
      'fake-gold',
      'answers:run-1.jsonl',
    ])
  })

  it('refuses to run a real provider, and says how to score one instead', () => {
    for (const name of ['openai', 'anthropic']) {
      const attempt = () => resolveProviders(name, context)

      expect(attempt).toThrow(EvaluationProviderError)
      expect(attempt).toThrow(/is not wired into this command/u)
      expect(attempt).toThrow(/answers:<file>/u)
    }
  })

  it('refuses a name it does not know, an empty list, an empty path and a repeat', () => {
    expect(() => resolveProviders('gpt-9', context)).toThrow(/unknown provider 'gpt-9'/u)
    expect(() => resolveProviders(' , ', context)).toThrow(/no provider was named/u)
    expect(() => resolveProviders('answers:', context)).toThrow(/needs a file path/u)
    expect(() => resolveProviders('fake-gold,fake-gold', context)).toThrow(/named twice/u)
  })
})
