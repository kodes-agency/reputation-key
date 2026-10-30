// The review-analysis v3 evaluation command (contract section 8, slice 3.9):
//
//   pnpm eval:review-analysis-v3 -- --providers fake-gold --out test-results/review-analysis-v3
//
// It loads the synthetic test set, asks each provider the production question
// (the production prompt, redaction, request payload and normalizer), scores the
// answers against the gold with the gates of decision 6, and writes a JSON report,
// an HTML page and every final label to a local folder. It never calls a provider:
// the providers it can name are a fake, a file of recorded answers, and two real
// ones that are declared and refuse to run (review-analysis-v3-providers.ts).
// Exit codes: 0 every gate passed, 1 a gate failed or could not be measured over
// the whole set, 2 the command, the test set or a provider could not be used.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/review-analysis-v3-normalizer'
import { REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT } from '#/shared/review-analysis-v3-prompt'
import { REVIEW_ATTENTION_V2_DIGEST } from '#/shared/review-analysis-v3'
import {
  PROPERTY_ISSUE_NORMALIZATION_DIGEST,
  PROPERTY_ISSUE_NORMALIZATION_VERSION,
  normalizeIssueThing,
} from '#/shared/property-issue-normalization'
import {
  REVIEW_SENTENCES_DIGEST,
  REVIEW_SENTENCES_VERSION,
} from '#/shared/review-sentences'
import {
  REVIEW_TOPIC_TAXONOMY_V3_DIGEST,
  REVIEW_TOPIC_TAXONOMY_VERSION,
} from '#/shared/review-topic-taxonomy'
import {
  REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST,
  selectVocabularyHintSet,
} from '#/shared/review-vocabulary-hints'
import { RELEASE_GATES_V1 } from './review-analysis-v3-gates'
import type { CauseKey } from './review-analysis-v3-mention-metrics'
import type { ScoredRun } from './review-analysis-v3-metrics'
import {
  EVALUATION_REDACTION_COUNTRY,
  acceptEvaluationAnswer,
  prepareEvaluationItem,
  runProvider,
  type ItemRunResult,
  type PreparedEvaluationItem,
} from './review-analysis-v3-provider'
import { EvaluationProviderError, resolveProviders } from './review-analysis-v3-providers'
import {
  EVALUATION_HARNESS_VERSION,
  buildProviderReport,
  renderConsoleSummary,
  renderLabelsJsonl,
  renderReportHtml,
  renderReportJson,
  worstVerdict,
  type EvaluationReport,
  type ProviderReport,
} from './review-analysis-v3-report'
import {
  TestSetError,
  buildTestSet,
  digestTestSetFiles,
  parseEvaluationItems,
  parseGoldLabels,
  type ScoredItem,
  type TestSet,
} from './review-analysis-v3-testset'

const FIXTURE_DIRECTORY = 'test-fixtures/review-analysis-v3'
const DEFAULT_ITEMS = Object.freeze([
  `${FIXTURE_DIRECTORY}/items-codex.jsonl`,
  `${FIXTURE_DIRECTORY}/items-claude.jsonl`,
])
const DEFAULT_GOLD = `${FIXTURE_DIRECTORY}/gold-v1.jsonl`
const DEFAULT_OUT = 'test-results/review-analysis-v3'
const MAX_RUNS = 5
const COUNTRY_PATTERN = /^[A-Z]{2}$/

const USAGE = [
  'usage: pnpm eval:review-analysis-v3 -- [options]',
  '  --providers <list>  comma-separated: fake-gold, answers:<file>   (default fake-gold)',
  `  --items <files>     comma-separated JSONL   (default ${DEFAULT_ITEMS.join(',')})`,
  `  --gold <file>       gold labels JSONL        (default ${DEFAULT_GOLD})`,
  `  --out <dir>         where the reports go     (default ${DEFAULT_OUT})`,
  `  --runs <n>          runs per provider, 1-${MAX_RUNS}   (default 1; use 2 on a live provider to measure instability)`,
  `  --country <XX>      country the redactor reads phone numbers for   (default ${EVALUATION_REDACTION_COUNTRY})`,
  'openai and anthropic are declared and not wired: score their recorded answers with answers:<file>.',
].join('\n')

export type CliIo = Readonly<{
  readFile: (path: string) => string
  writeFile: (path: string, content: string) => void
  makeDirectory: (path: string) => void
  print: (text: string) => void
  printError: (text: string) => void
  now: () => Date
}>

/** What the scorer needs from the product's governed vocabulary. */
export type CliTools = Readonly<{
  causeKey: CauseKey
  familyOf: (business: string) => string
}>

export const DEFAULT_CLI_TOOLS: CliTools = Object.freeze({
  causeKey: (topic, thing) => normalizeIssueThing(topic, thing).canonicalKey,
  familyOf: (business) => selectVocabularyHintSet(business).id,
})

type CliOptions = Readonly<{
  providers: string
  items: readonly string[]
  gold: string
  out: string
  runs: number
  country: string
}>

type ParsedArguments =
  | Readonly<{ status: 'run'; options: CliOptions }>
  | Readonly<{ status: 'help' }>
  | Readonly<{ status: 'invalid'; message: string }>

const VALUE_FLAGS = Object.freeze([
  '--providers',
  '--items',
  '--gold',
  '--out',
  '--runs',
  '--country',
] as const)

function splitList(value: string): readonly string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function readFlags(argv: readonly string[]): ReadonlyMap<string, string> | string {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === undefined || !(VALUE_FLAGS as readonly string[]).includes(flag)) {
      return `unknown option '${flag ?? ''}'`
    }
    if (value === undefined || value.startsWith('--')) return `${flag} needs a value`
    if (flags.has(flag)) return `${flag} was given twice`
    flags.set(flag, value)
  }
  return flags
}

export function parseCliArguments(argv: readonly string[]): ParsedArguments {
  const args = argv.filter((arg) => arg !== '--')
  if (args.includes('--help')) return { status: 'help' }
  const flags = readFlags(args)
  if (typeof flags === 'string') return { status: 'invalid', message: flags }
  const runs = Number(flags.get('--runs') ?? '1')
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    return {
      status: 'invalid',
      message: `--runs must be a whole number from 1 to ${MAX_RUNS}`,
    }
  }
  const country = flags.get('--country') ?? EVALUATION_REDACTION_COUNTRY
  if (!COUNTRY_PATTERN.test(country)) {
    return { status: 'invalid', message: '--country must be a two-letter country code' }
  }
  const items = splitList(flags.get('--items') ?? DEFAULT_ITEMS.join(','))
  if (items.length === 0) return { status: 'invalid', message: '--items names no file' }
  return {
    status: 'run',
    options: Object.freeze({
      providers: flags.get('--providers') ?? 'fake-gold',
      items: Object.freeze(items),
      gold: flags.get('--gold') ?? DEFAULT_GOLD,
      out: flags.get('--out') ?? DEFAULT_OUT,
      runs,
      country,
    }),
  }
}

type LoadedTestSet = Readonly<{ testSet: TestSet; digest: string }>

function loadTestSet(options: CliOptions, io: CliIo): LoadedTestSet {
  const itemFiles = options.items.map((path) => ({ path, source: io.readFile(path) }))
  const goldSource = io.readFile(options.gold)
  const items = itemFiles.flatMap((file) => parseEvaluationItems(file.path, file.source))
  const gold = parseGoldLabels(options.gold, goldSource)
  const digest = digestTestSetFiles([
    ...itemFiles.map((file) => ({ name: baseName(file.path), source: file.source })),
    { name: baseName(options.gold), source: goldSource },
  ])
  return { testSet: buildTestSet(items, gold), digest }
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

type Reference = Readonly<{
  answer: ScoredRun['reference']
  changed: boolean
  droppedMentions: number
}>

/** The gold as the production normalizer accepts it: the answer a perfect provider reaches. */
function referenceOf(scored: ScoredItem, prepared: PreparedEvaluationItem): Reference {
  const { id: _id, gold_source: _source, ...label } = scored.gold
  const evidence =
    prepared.status === 'prepared'
      ? prepared.evidence
      : { redactedSentences: scored.item.sentences, vocabularyHints: {} }
  const accepted = acceptEvaluationAnswer(label, evidence)
  if (accepted === null) {
    throw new TestSetError([
      `${scored.item.id}: the gold label is not accepted by the production normalizer`,
    ])
  }
  return {
    answer: accepted.answer,
    changed: accepted.flags.length > 0 || accepted.droppedMentionCount > 0,
    droppedMentions: accepted.droppedMentionCount,
  }
}

function versionsOf(): Readonly<Record<string, string>> {
  return Object.freeze({
    harness: EVALUATION_HARNESS_VERSION,
    gates: RELEASE_GATES_V1.version,
    normalizer: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
    normalizerDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
    topicTaxonomy: REVIEW_TOPIC_TAXONOMY_VERSION,
    topicTaxonomyDigest: REVIEW_TOPIC_TAXONOMY_V3_DIGEST,
    sentenceRules: REVIEW_SENTENCES_VERSION,
    sentenceRulesDigest: REVIEW_SENTENCES_DIGEST,
    attentionDigest: REVIEW_ATTENTION_V2_DIGEST,
    promptDigest: createHash('sha256')
      .update(REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT, 'utf8')
      .digest('hex'),
    vocabularyHintsDigest: REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST,
    issueNormalization: PROPERTY_ISSUE_NORMALIZATION_VERSION,
    issueNormalizationDigest: PROPERTY_ISSUE_NORMALIZATION_DIGEST,
  })
}

function fileSafe(id: string): string {
  return id.replaceAll(/[^a-z0-9._-]+/giu, '-')
}

type Entry = Readonly<{
  scored: ScoredItem
  prepared: PreparedEvaluationItem
  reference: Reference
}>

function entriesOf(testSet: TestSet, country: string): readonly Entry[] {
  return testSet.scored.map((scored): Entry => {
    const prepared = prepareEvaluationItem(scored.item, { redactionCountry: country })
    return { scored, prepared, reference: referenceOf(scored, prepared) }
  })
}

/** Pair each reviewed item with what the provider made of it in one run. */
function scoredRunsOf(
  entries: readonly Entry[],
  results: readonly ItemRunResult[],
): readonly ScoredRun[] {
  const byId = new Map(results.map((result) => [result.itemId, result] as const))
  return entries.map((entry) => {
    const result = byId.get(entry.scored.item.id)
    if (result === undefined) throw new Error('a provider run lost a review')
    return { item: entry.scored.item, reference: entry.reference.answer, result }
  })
}

async function evaluate(
  options: CliOptions,
  io: CliIo,
  tools: CliTools,
): Promise<EvaluationReport> {
  const { testSet, digest } = loadTestSet(options, io)
  const providers = resolveProviders(options.providers, {
    testSet,
    readFile: io.readFile,
  })
  const entries = entriesOf(testSet, options.country)
  const prepared = entries.map((entry) => entry.prepared)
  const reports: ProviderReport[] = []
  for (const provider of providers) {
    const runs: (readonly ScoredRun[])[] = []
    for (let run = 1; run <= options.runs; run += 1) {
      const results = await runProvider(provider, prepared)
      io.writeFile(
        join(options.out, `labels-${fileSafe(provider.id)}-run${run}.jsonl`),
        renderLabelsJsonl(results),
      )
      runs.push(scoredRunsOf(entries, results))
    }
    reports.push(buildProviderReport(provider, runs, tools))
  }
  return Object.freeze({
    harnessVersion: EVALUATION_HARNESS_VERSION,
    createdAt: io.now().toISOString(),
    versions: versionsOf(),
    testSet: Object.freeze({
      digest,
      items: testSet.items.length,
      scored: testSet.scored.length,
      unsettledIds: testSet.unsettledIds,
      goldChangedByNormalizer: Object.freeze({
        ids: Object.freeze(
          entries
            .filter((entry) => entry.reference.changed)
            .map((entry) => entry.scored.item.id),
        ),
        droppedMentions: entries.reduce(
          (total, entry) => total + entry.reference.droppedMentions,
          0,
        ),
      }),
    }),
    thresholds: RELEASE_GATES_V1,
    providers: Object.freeze(reports),
    verdict: worstVerdict(reports.map((report) => report.verdict)),
  })
}

/** Run the command. Returns the exit code; prints through `io`, never throws on bad input. */
export async function runEvaluationCli(
  argv: readonly string[],
  io: CliIo,
  tools: CliTools = DEFAULT_CLI_TOOLS,
): Promise<number> {
  const parsed = parseCliArguments(argv)
  if (parsed.status === 'help') {
    io.print(`${USAGE}\n`)
    return 0
  }
  if (parsed.status === 'invalid') {
    io.printError(`${parsed.message}\n${USAGE}\n`)
    return 2
  }
  try {
    io.makeDirectory(parsed.options.out)
    const report = await evaluate(parsed.options, io, tools)
    io.writeFile(join(parsed.options.out, 'report.json'), renderReportJson(report))
    io.writeFile(join(parsed.options.out, 'report.html'), renderReportHtml(report))
    io.print(renderConsoleSummary(report))
    io.print(`reports written to ${parsed.options.out}\n`)
    return report.verdict === 'pass' ? 0 : 1
  } catch (error) {
    if (error instanceof TestSetError || error instanceof EvaluationProviderError) {
      io.printError(`${error.message}\n`)
      return 2
    }
    throw error
  }
}

function nodeIo(): CliIo {
  return {
    readFile: (path) => readFileSync(resolve(path), 'utf8'),
    writeFile: (path, content) => writeFileSync(resolve(path), content, 'utf8'),
    makeDirectory: (path) => {
      mkdirSync(resolve(path), { recursive: true })
    },
    print: (text) => process.stdout.write(text),
    printError: (text) => process.stderr.write(text),
    now: () => new Date(),
  }
}

// Real paths, not addresses compared as text: started through a symbolic link the
// text differs and the command would print nothing and exit 0. This is the check
// of scripts/ci/entry-point.ts, written out because the boundary policy keeps a
// script outside scripts/ci from importing that module.
const startedScript = process.argv[1]
if (
  startedScript !== undefined &&
  realpathSync(startedScript) === realpathSync(fileURLToPath(import.meta.url))
) {
  runEvaluationCli(process.argv.slice(2), nodeIo())
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exitCode = 2
    })
}
