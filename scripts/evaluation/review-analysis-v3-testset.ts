// The test set of the review-analysis v3 evaluation (contract section 8): items,
// gold labels and the checks that tie them to the production sentence splitter.
//
// Every item is synthetic (test-fixtures/review-analysis-v3/README.md). The loader
// is strict because a scorer that silently skips a malformed line reports a better
// number than the provider earned. A problem names the file, the line and the
// field, never the text of a review: the same loader reads the live slice later.

import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_SENTIMENTS_V3,
  REVIEW_STRENGTHS_V3,
  REVIEW_URGENT_REASONS_V3,
} from '#/shared/review-analysis-v3'
import { isGenericThingWord } from '#/shared/review-generic-things'
import { splitReviewSentences } from '#/shared/review-sentences'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'

const MAX_REPORTED_PROBLEMS = 20

const itemSchema = z
  .object({
    id: z.string().min(1),
    business: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    language: z.string().min(1),
    text: z.string().min(1),
    sentences: z.array(z.string().min(1)).min(1),
    tags: z.array(z.string().min(1)),
  })
  .strict()

// A gold phrase is looser than the stored contract on purpose: a label such as
// "30 minutes" is a fair judgement that the stored contract cannot hold (its
// phrases are letters). The scorer compares against the label as the production
// normalizer accepts it, and reports how many labels that changed.
const goldMentionSchema = z
  .object({
    topic: z.enum(REVIEW_TOPICS_V3),
    polarity: z.enum(REVIEW_POLARITIES_V3),
    strength: z.enum(REVIEW_STRENGTHS_V3),
    thing: z.string().min(1).nullable(),
    issue: z.string().min(1).nullable(),
    sentences: z.array(z.number().int().min(1)).min(1),
    names_person: z.enum(REVIEW_NAMES_PERSON_V3).nullable(),
  })
  .strict()

const goldLabelSchema = z
  .object({
    id: z.string().min(1),
    sentiment: z.enum(REVIEW_SENTIMENTS_V3),
    mentions: z.array(goldMentionSchema),
    urgent: z
      .object({ reason: z.enum(REVIEW_URGENT_REASONS_V3) })
      .strict()
      .nullable(),
    gold_source: z.string().min(1),
  })
  .strict()

export type EvaluationItem = z.infer<typeof itemSchema>
export type GoldLabel = z.infer<typeof goldLabelSchema>

/** The test set (or a file of it) is not usable; `problems` name where, never what. */
export class TestSetError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS)
    const hidden = problems.length - shown.length
    super(
      [
        `the test set has ${problems.length} problem(s)`,
        ...shown,
        ...(hidden > 0 ? [`... and ${hidden} more`] : []),
      ].join('\n'),
    )
    this.name = 'TestSetError'
    this.problems = Object.freeze([...problems])
  }
}

/** Parse one JSON object per line; blank lines are skipped, anything else must fit. */
export function parseJsonLines<Row>(
  label: string,
  source: string,
  schema: z.ZodType<Row>,
): readonly Row[] {
  const rows: Row[] = []
  const problems: string[] = []
  source.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    const where = `${label}:${index + 1}`
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      problems.push(`${where}: not JSON`)
      return
    }
    const parsed = schema.safeParse(json)
    if (parsed.success) {
      rows.push(parsed.data)
      return
    }
    for (const issue of parsed.error.issues) {
      const path = issue.path.length === 0 ? 'line' : issue.path.join('.')
      problems.push(`${where}: ${path}: ${issue.message}`)
    }
  })
  if (problems.length > 0) throw new TestSetError(problems)
  return Object.freeze(rows)
}

export function parseEvaluationItems(
  label: string,
  source: string,
): readonly EvaluationItem[] {
  return parseJsonLines(label, source, itemSchema)
}

export function parseGoldLabels(label: string, source: string): readonly GoldLabel[] {
  return parseJsonLines(label, source, goldLabelSchema)
}

/** An item and the label that settles it. */
export type ScoredItem = Readonly<{ item: EvaluationItem; gold: GoldLabel }>

export type TestSet = Readonly<{
  /** Every item, in file order. */
  items: readonly EvaluationItem[]
  /** The items that have a settled gold label, in file order. */
  scored: readonly ScoredItem[]
  /** Items without a gold label yet: left out of every score. */
  unsettledIds: readonly string[]
}>

function duplicateIds(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  return [...repeated]
}

function itemProblems(item: EvaluationItem): readonly string[] {
  const problems: string[] = []
  const expected = splitReviewSentences(item.text)
  if (JSON.stringify(expected) !== JSON.stringify(item.sentences)) {
    problems.push(`${item.id}: sentences differ from the production splitter`)
  }
  return problems
}

function goldProblems(gold: GoldLabel, sentenceCount: number): readonly string[] {
  const problems: string[] = []
  gold.mentions.forEach((mention, index) => {
    if (mention.sentences.some((number) => number > sentenceCount)) {
      problems.push(
        `${gold.id}: mention ${index} cites a sentence the item does not have`,
      )
    }
    if (mention.thing !== null && mention.issue === null) {
      problems.push(`${gold.id}: mention ${index} has a thing and no issue`)
    }
    if (isGenericThingWord(mention.thing)) {
      problems.push(
        `${gold.id}: mention ${index} names a generic word as its thing (guide v3.3, rule 3)`,
      )
    }
  })
  return problems
}

/** Tie items and gold together; throw a `TestSetError` listing everything wrong. */
export function buildTestSet(
  items: readonly EvaluationItem[],
  gold: readonly GoldLabel[],
): TestSet {
  const problems: string[] = []
  for (const id of duplicateIds(items.map((item) => item.id))) {
    problems.push(`${id}: the item id is used twice`)
  }
  for (const id of duplicateIds(gold.map((label) => label.id))) {
    problems.push(`${id}: the gold label id is used twice`)
  }
  for (const item of items) problems.push(...itemProblems(item))

  const itemById = new Map(items.map((item) => [item.id, item] as const))
  const goldById = new Map(gold.map((label) => [label.id, label] as const))
  for (const label of gold) {
    const item = itemById.get(label.id)
    if (item === undefined) problems.push(`${label.id}: a gold label without an item`)
    else problems.push(...goldProblems(label, item.sentences.length))
  }
  if (problems.length > 0) throw new TestSetError(problems)

  const scored: ScoredItem[] = []
  const unsettledIds: string[] = []
  for (const item of items) {
    const label = goldById.get(item.id)
    if (label === undefined) unsettledIds.push(item.id)
    else scored.push(Object.freeze({ item, gold: label }))
  }
  return Object.freeze({
    items: Object.freeze([...items]),
    scored: Object.freeze(scored),
    unsettledIds: Object.freeze(unsettledIds),
  })
}

/** The digest the report records, so a score names the exact files it came from. */
export function digestTestSetFiles(
  files: readonly Readonly<{ name: string; source: string }>[],
): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(`${file.name}\0`, 'utf8')
    hash.update(createHash('sha256').update(file.source, 'utf8').digest('hex'), 'utf8')
    hash.update('\0', 'utf8')
  }
  return hash.digest('hex')
}
