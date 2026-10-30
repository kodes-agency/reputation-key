import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TestSetError,
  buildTestSet,
  digestTestSetFiles,
  parseEvaluationItems,
  parseGoldLabels,
} from './review-analysis-v3-testset'

const FIXTURES = join(
  import.meta.dirname,
  '..',
  '..',
  'test-fixtures',
  'review-analysis-v3',
)
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

const ITEM_LINE = JSON.stringify({
  id: 'cx-9001',
  business: 'Hotel',
  rating: 2,
  language: 'en',
  text: 'The lift was broken. Nobody came.',
  sentences: ['The lift was broken.', 'Nobody came.'],
  tags: [],
})
const GOLD_LINE = JSON.stringify({
  id: 'cx-9001',
  sentiment: 'negative',
  mentions: [
    {
      topic: 'facilities_equipment',
      polarity: 'negative',
      strength: 'clear',
      thing: 'lift',
      issue: 'broken',
      sentences: [1],
      names_person: null,
    },
  ],
  urgent: null,
  gold_source: 'round1_both_families',
})

describe('the synthetic test set in test-fixtures', () => {
  const items = [
    ...parseEvaluationItems('items-codex.jsonl', read('items-codex.jsonl')),
    ...parseEvaluationItems('items-claude.jsonl', read('items-claude.jsonl')),
  ]
  const gold = parseGoldLabels('gold-v1.jsonl', read('gold-v1.jsonl'))
  const testSet = buildTestSet(items, gold)

  it('holds 400 reviews, 200 from each generator, and 395 settled labels', () => {
    expect(items).toHaveLength(400)
    expect(items.filter((one) => one.id.startsWith('cx-'))).toHaveLength(200)
    expect(items.filter((one) => one.id.startsWith('cl-'))).toHaveLength(200)
    expect(gold).toHaveLength(395)
    expect(testSet.scored).toHaveLength(395)
  })

  it('names the five reviews still waiting for a label', () => {
    expect(testSet.unsettledIds).toEqual([
      'cl-0021',
      'cl-0054',
      'cl-0163',
      'cl-0174',
      'cl-0188',
    ])
  })

  it('covers English, Bulgarian, Spanish and a few others', () => {
    const count = (language: string) =>
      items.filter((one) => one.language === language).length

    expect(count('en')).toBe(240)
    expect(count('bg')).toBe(80)
    expect(count('es')).toBe(60)
    expect(count('de') + count('mixed')).toBe(20)
  })

  it('has thirty urgent cases, all in English', () => {
    const urgent = testSet.scored.filter((entry) => entry.gold.urgent !== null)
    const reasons = urgent.map((entry) => entry.gold.urgent?.reason)

    expect(urgent).toHaveLength(30)
    expect(urgent.every((entry) => entry.item.language === 'en')).toBe(true)
    expect(reasons.filter((reason) => reason === 'safety')).toHaveLength(11)
    expect(reasons.filter((reason) => reason === 'health')).toHaveLength(9)
    expect(reasons.filter((reason) => reason === 'discrimination')).toHaveLength(4)
    expect(reasons.filter((reason) => reason === 'legal_threat')).toHaveLength(6)
  })

  it('cuts every review into the sentences the production splitter makes', () => {
    // buildTestSet refuses a mismatch; this pins that the check ran on every item.
    expect(testSet.items).toHaveLength(400)
  })
})

describe('parsing', () => {
  it('skips blank lines and reads what is there', () => {
    const rows = parseEvaluationItems('items.jsonl', `\n${ITEM_LINE}\n\n`)

    expect(rows.map((row) => row.id)).toEqual(['cx-9001'])
  })

  it('names the file, the line and the field of a problem, never the text', () => {
    const broken = JSON.stringify({ ...JSON.parse(ITEM_LINE), rating: 7 })

    const attempt = () => parseEvaluationItems('items.jsonl', `${ITEM_LINE}\n${broken}`)

    expect(attempt).toThrow(TestSetError)
    expect(attempt).toThrow(/items\.jsonl:2: rating/u)
    expect(attempt).not.toThrow(/lift/u)
  })

  it('rejects a line that is not JSON and a key it does not know', () => {
    expect(() => parseEvaluationItems('items.jsonl', 'not json')).toThrow(
      /items\.jsonl:1: not JSON/u,
    )
    const extra = JSON.stringify({ ...JSON.parse(ITEM_LINE), extra: true })
    expect(() => parseEvaluationItems('items.jsonl', extra)).toThrow(TestSetError)
  })

  it('accepts a gold phrase the stored contract could not hold', () => {
    const odd = JSON.stringify({
      ...JSON.parse(GOLD_LINE),
      mentions: [{ ...JSON.parse(GOLD_LINE).mentions[0], issue: '30 minutes' }],
    })

    expect(parseGoldLabels('gold.jsonl', odd)[0]?.mentions[0]?.issue).toBe('30 minutes')
  })
})

describe('buildTestSet', () => {
  const items = parseEvaluationItems('items.jsonl', ITEM_LINE)
  const gold = parseGoldLabels('gold.jsonl', GOLD_LINE)

  it('scores the reviews that have a label and sets the others aside', () => {
    const second = parseEvaluationItems(
      'items.jsonl',
      JSON.stringify({ ...JSON.parse(ITEM_LINE), id: 'cx-9002' }),
    )

    const set = buildTestSet([...items, ...second], gold)

    expect(set.scored.map((entry) => entry.item.id)).toEqual(['cx-9001'])
    expect(set.unsettledIds).toEqual(['cx-9002'])
  })

  it('refuses a review whose sentences are not the splitter’s', () => {
    const wrong = parseEvaluationItems(
      'items.jsonl',
      JSON.stringify({
        ...JSON.parse(ITEM_LINE),
        sentences: ['The lift was broken. Nobody came.'],
      }),
    )

    expect(() => buildTestSet(wrong, gold)).toThrow(/cx-9001: sentences differ/u)
  })

  it('refuses a label with no review, a repeated id and a missing sentence', () => {
    const orphan = parseGoldLabels(
      'gold.jsonl',
      JSON.stringify({ ...JSON.parse(GOLD_LINE), id: 'cx-9999' }),
    )
    const far = parseGoldLabels(
      'gold.jsonl',
      JSON.stringify({
        ...JSON.parse(GOLD_LINE),
        mentions: [{ ...JSON.parse(GOLD_LINE).mentions[0], sentences: [3] }],
      }),
    )

    expect(() => buildTestSet(items, orphan)).toThrow(
      /cx-9999: a gold label without an item/u,
    )
    expect(() => buildTestSet([...items, ...items], gold)).toThrow(/used twice/u)
    expect(() => buildTestSet(items, far)).toThrow(
      /cites a sentence the item does not have/u,
    )
  })

  it('lists every problem, not only the first', () => {
    const attempt = () => buildTestSet([...items, ...items], [...gold, ...gold])

    expect(attempt).toThrow(/2 problem/u)
  })
})

describe('digestTestSetFiles', () => {
  const files = [
    { name: 'items.jsonl', source: ITEM_LINE },
    { name: 'gold.jsonl', source: GOLD_LINE },
  ]

  it('does not depend on the order the files are given in', () => {
    expect(digestTestSetFiles(files)).toBe(digestTestSetFiles([...files].reverse()))
  })

  it('changes when a byte of a file changes', () => {
    const changed = [
      files[0] ?? { name: '', source: '' },
      { name: 'gold.jsonl', source: `${GOLD_LINE} ` },
    ]

    expect(digestTestSetFiles(changed)).not.toBe(digestTestSetFiles(files))
  })

  it('is a sha-256 hex digest', () => {
    expect(digestTestSetFiles(files)).toMatch(/^[0-9a-f]{64}$/u)
  })
})
