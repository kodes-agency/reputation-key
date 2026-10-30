// The evaluation harness against the real synthetic test set and a fake provider
// (contract section 8, slice 3.9). Nothing here calls a provider: the providers
// are the fake that answers with the gold, and files of answers the tests write
// themselves. The last describe pins that the harness cannot reach one.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROPERTY_ISSUE_NORMALIZATION_DIGEST,
  PROPERTY_ISSUE_NORMALIZATION_VERSION,
} from '#/shared/property-issue-normalization'
import {
  DEFAULT_CLI_TOOLS,
  parseCliArguments,
  runEvaluationCli,
  type CliIo,
} from './review-analysis-v3'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT = 'out'

type Row = Record<string, unknown>

const goldRows: readonly Row[] = readFileSync(
  join(ROOT, 'test-fixtures/review-analysis-v3/gold-v1.jsonl'),
  'utf8',
)
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as Row)

const itemLanguage = new Map<string, string>(
  ['items-codex.jsonl', 'items-claude.jsonl'].flatMap((name) =>
    readFileSync(join(ROOT, 'test-fixtures/review-analysis-v3', name), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const row = JSON.parse(line) as { id: string; language: string }
        return [row.id, row.language] as const
      }),
  ),
)

type Harness = Readonly<{
  io: CliIo
  files: Map<string, string>
  printed: string[]
  errors: string[]
}>

/** An in-memory command line: the fixtures are read from disk, everything else is virtual. */
function harness(virtualFiles: Readonly<Record<string, string>> = {}): Harness {
  const files = new Map<string, string>()
  const printed: string[] = []
  const errors: string[] = []
  const io: CliIo = {
    readFile: (path) => {
      const virtual = virtualFiles[path]
      return virtual ?? readFileSync(join(ROOT, path), 'utf8')
    },
    writeFile: (path, content) => {
      files.set(path, content)
    },
    makeDirectory: () => {},
    print: (text) => printed.push(text),
    printError: (text) => errors.push(text),
    now: () => new Date('2026-10-30T12:00:00.000Z'),
  }
  return { io, files, printed, errors }
}

function reportOf(files: ReadonlyMap<string, string>) {
  const json = files.get(join(OUT, 'report.json'))
  if (json === undefined) throw new Error('the command wrote no report')
  return JSON.parse(json)
}

/** Recorded answers for every labelled review: its gold, changed by `change`. */
function answersFile(change: (gold: Row) => Row): string {
  return goldRows
    .map((gold) => {
      const { id, gold_source: _source, ...answer } = change(gold)
      return JSON.stringify({ id, answer })
    })
    .join('\n')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the fake provider that answers with the gold', () => {
  it('passes every gate and exits 0', async () => {
    const { io, files, printed } = harness()

    const code = await runEvaluationCli(['--providers', 'fake-gold', '--out', OUT], io)

    const report = reportOf(files)
    expect(code).toBe(0)
    expect(report.verdict).toBe('pass')
    expect(report.providers).toHaveLength(1)
    expect(report.providers[0]).toMatchObject({ id: 'fake-gold', verdict: 'pass' })
    expect(printed.join('')).toContain('review analysis v3 evaluation: PASS')
  })

  it('scores 395 of the 400 reviews and names the five still without a label', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    const { testSet } = reportOf(files)
    expect(testSet).toMatchObject({ items: 400, scored: 395 })
    expect(testSet.unsettledIds).toEqual([
      'cl-0021',
      'cl-0054',
      'cl-0163',
      'cl-0174',
      'cl-0188',
    ])
    expect(testSet.digest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('reports the gold labels the production normalizer would not accept as written', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    // Two issues that are numbers of minutes ("30 minutes") lose their cause, and one cause
    // repeats the review. The mentions stay: an invalid cause is emptied, never dropped.
    // The scorer's reference is the label as it is accepted.
    expect(reportOf(files).testSet.goldChangedByNormalizer).toEqual({
      ids: ['cl-0090', 'cl-0147', 'cl-0179'],
      droppedMentions: 0,
    })
  })

  it('reaches the ceiling on every score', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    const all = reportOf(files).providers[0].runs[0].scores.gating.all
    expect(all.sentiment.accuracy).toBe(1)
    expect(all.topics.micro.f1).toBe(1)
    expect(all.topics.weakest.f1).toBe(1)
    expect(all.mentions.causes.thingAgreement).toBe(1)
    expect(all.mentions.causes.fullAgreement).toBe(1)
    expect(all.mentions.evidence.f1).toBe(1)
    expect(all.urgent).toMatchObject({ goldUrgent: 30, detected: 30, falseUrgent: 0 })
    expect(all.urgent.recall).toBe(1)
    expect(all.robustness.usableRate).toBe(1)
  })

  it('cannot read Bulgarian and Spanish Urgent recall, because the set has no such case', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    const gates = reportOf(files).providers[0].runs[0].gates
    const unmeasured = gates.unmeasured.map(
      (result: { slice: string; gate: string }) => `${result.slice} ${result.gate}`,
    )
    expect(unmeasured).toEqual([
      'bg urgent_safety_health_misses',
      'bg urgent_recall',
      'es urgent_safety_health_misses',
      'es urgent_recall',
    ])
    expect(gates.verdict).toBe('pass')
  })

  it('writes the report, the page and the final label of every scored review', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    expect([...files.keys()].sort()).toEqual([
      join(OUT, 'labels-fake-gold-run1.jsonl'),
      join(OUT, 'report.html'),
      join(OUT, 'report.json'),
    ])
    const labels = (files.get(join(OUT, 'labels-fake-gold-run1.jsonl')) ?? '')
      .trim()
      .split('\n')
    expect(labels).toHaveLength(395)
    expect(files.get(join(OUT, 'report.html'))).toContain('<!doctype html>')
  })

  it('names the reviews the redactor changed and the reviews the live path would not send', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    // The redactor reads "oil.For" and "working.Not" (no space after the stop) as
    // domains and "passport" as an identifier: its real behaviour on invented text.
    expect(reportOf(files).testSet).toMatchObject({
      redactionChangedIds: ['cl-0041', 'cl-0138', 'cl-0184'],
      notSentIds: [],
    })
  })

  it('records the versions the numbers were measured against', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--out', OUT], io)

    expect(reportOf(files).versions).toMatchObject({
      operationProfile: expect.stringMatching(/^[0-9a-f]{64}$/u),
      normalizer: 'review-analysis-normalization-v1',
      topicTaxonomy: 'review-topic-taxonomy-v3',
      sentenceRules: 'review-sentences-v1',
      gates: 'review-analysis-gates-v1',
      issueNormalization: PROPERTY_ISSUE_NORMALIZATION_VERSION,
      issueNormalizationDigest: PROPERTY_ISSUE_NORMALIZATION_DIGEST,
    })
  })

  it('shows no run-to-run disagreement from a provider that never changes its mind', async () => {
    const { io, files } = harness()

    await runEvaluationCli(['--runs', '2', '--out', OUT], io)

    const provider = reportOf(files).providers[0]
    expect(provider.runs).toHaveLength(2)
    expect(provider.instability).toMatchObject({ items: 395, differentLabels: 0 })
    expect(files.has(join(OUT, 'labels-fake-gold-run2.jsonl'))).toBe(true)
  })
})

describe('a provider that gets Urgent wrong', () => {
  it('fails the safety and health gate and exits 1', async () => {
    const { io, files, printed } = harness({
      'answers/no-urgent.jsonl': answersFile((gold) => ({ ...gold, urgent: null })),
    })

    const code = await runEvaluationCli(
      ['--providers', 'answers:answers/no-urgent.jsonl', '--out', OUT],
      io,
    )

    const failures = reportOf(files).providers[0].runs[0].gates.failures
    const byGate = (gate: string, slice: string) =>
      failures.find(
        (one: { gate: string; slice: string }) =>
          one.gate === gate && one.slice === slice,
      )
    expect(code).toBe(1)
    expect(byGate('urgent_safety_health_misses', 'all')).toMatchObject({ value: 20 })
    expect(byGate('urgent_recall', 'all')).toMatchObject({ value: 0 })
    expect(byGate('urgent_recall', 'en')).toMatchObject({ value: 0 })
    expect(printed.join('')).toContain('review analysis v3 evaluation: FAIL')
  })

  it('fails when it raises Urgent on more than two in a hundred of the other reviews', async () => {
    const { io, files } = harness({
      'answers/alarmist.jsonl': answersFile((gold) => ({
        ...gold,
        urgent: gold.urgent ?? { reason: 'safety' },
      })),
    })

    const code = await runEvaluationCli(
      ['--providers', 'answers:answers/alarmist.jsonl', '--out', OUT],
      io,
    )

    const gates = reportOf(files).providers[0].runs[0].gates
    expect(code).toBe(1)
    expect(
      gates.failures.some((one: { gate: string }) => one.gate === 'urgent_false_rate'),
    ).toBe(true)
  })
})

describe('a provider that gets topics wrong', () => {
  it('fails the gate on the weakest topic and says which topic it is', async () => {
    const { io, files } = harness({
      'answers/no-staff.jsonl': answersFile((gold) => ({
        ...gold,
        mentions: (gold.mentions as Row[]).filter(
          (mention) => mention.topic !== 'staff_service',
        ),
      })),
    })

    const code = await runEvaluationCli(
      ['--providers', 'answers:answers/no-staff.jsonl', '--out', OUT],
      io,
    )

    const failure = reportOf(files).providers[0].runs[0].gates.failures.find(
      (one: { gate: string; slice: string }) =>
        one.gate === 'topic_min_f1' && one.slice === 'all',
    )
    expect(code).toBe(1)
    expect(failure).toMatchObject({ value: 0, note: 'weakest topic staff_service' })
  })

  it('is read in each language on its own', async () => {
    const { io, files } = harness({
      'answers/bg-blank.jsonl': answersFile((gold) =>
        itemLanguage.get(String(gold.id)) === 'bg'
          ? { ...gold, mentions: [], sentiment: 'neutral', urgent: null }
          : gold,
      ),
    })

    await runEvaluationCli(
      ['--providers', 'answers:answers/bg-blank.jsonl', '--out', OUT],
      io,
    )

    const results = reportOf(files).providers[0].runs[0].gates.results as {
      gate: string
      slice: string
      status: string
    }[]
    const status = (slice: string) =>
      results.find((one) => one.gate === 'topic_micro_f1' && one.slice === slice)?.status
    expect(status('bg')).toBe('fail')
    expect(status('en')).toBe('pass')
    expect(status('es')).toBe('pass')
  })
})

describe('what the command refuses', () => {
  it.each(['openai', 'anthropic'])(
    'does not run %s, which is declared and not wired',
    async (name) => {
      const { io, files, errors } = harness()

      const code = await runEvaluationCli(['--providers', name, '--out', OUT], io)

      expect(code).toBe(2)
      expect(errors.join('')).toContain(`${name} is not wired into this command`)
      expect(files.has(join(OUT, 'report.json'))).toBe(false)
    },
  )

  it('reports a test set it cannot trust instead of scoring part of it', async () => {
    const { io, errors } = harness({
      'broken-items.jsonl': '{"id": "cx-1"}\n',
    })

    const code = await runEvaluationCli(
      ['--items', 'broken-items.jsonl', '--out', OUT],
      io,
    )

    expect(code).toBe(2)
    expect(errors.join('')).toContain('broken-items.jsonl:1')
  })

  it('reports an answer file with no answer for a review as failed calls, not as a pass', async () => {
    const { io, files } = harness({
      'answers/empty.jsonl': '',
    })

    const code = await runEvaluationCli(
      ['--providers', 'answers:answers/empty.jsonl', '--out', OUT],
      io,
    )

    const all = reportOf(files).providers[0].runs[0].scores.gating.all
    expect(code).toBe(1)
    expect(all.robustness.byStatus).toEqual({ failed: 395 })
    expect(all.robustness.usableRate).toBe(0)
  })
})

describe('parseCliArguments', () => {
  it('defaults to the fake provider, the fixtures and one run', () => {
    expect(parseCliArguments(['--'])).toEqual({
      status: 'run',
      options: {
        providers: 'fake-gold',
        items: [
          'test-fixtures/review-analysis-v3/items-codex.jsonl',
          'test-fixtures/review-analysis-v3/items-claude.jsonl',
        ],
        gold: 'test-fixtures/review-analysis-v3/gold-v1.jsonl',
        out: 'test-results/review-analysis-v3',
        runs: 1,
        country: 'US',
      },
    })
  })

  it('reads every option', () => {
    const parsed = parseCliArguments([
      '--providers',
      'fake-gold,answers:a.jsonl',
      '--items',
      'a.jsonl, b.jsonl',
      '--gold',
      'g.jsonl',
      '--out',
      'somewhere',
      '--runs',
      '2',
      '--country',
      'BG',
    ])

    expect(parsed).toEqual({
      status: 'run',
      options: {
        providers: 'fake-gold,answers:a.jsonl',
        items: ['a.jsonl', 'b.jsonl'],
        gold: 'g.jsonl',
        out: 'somewhere',
        runs: 2,
        country: 'BG',
      },
    })
  })

  it.each([
    [['--nope', 'x'], /unknown option '--nope'/u],
    [['--out'], /--out needs a value/u],
    [['--out', '--runs'], /--out needs a value/u],
    [['--out', 'a', '--out', 'b'], /--out was given twice/u],
    [['--runs', '0'], /--runs must be a whole number from 1 to 5/u],
    [['--runs', '6'], /--runs must be a whole number from 1 to 5/u],
    [['--runs', '1.5'], /--runs must be a whole number from 1 to 5/u],
    [['--country', 'usa'], /two-letter country code/u],
    [['--items', ' , '], /--items names no file/u],
  ])('rejects %j', (argv, message) => {
    const parsed = parseCliArguments(argv)

    expect(parsed.status).toBe('invalid')
    expect(parsed.status === 'invalid' && parsed.message).toMatch(message)
  })

  it('prints the usage and exits 0 for --help, and exits 2 after a usage error', async () => {
    const help = harness()
    const bad = harness()

    expect(await runEvaluationCli(['--help'], help.io)).toBe(0)
    expect(help.printed.join('')).toContain('usage: pnpm eval:review-analysis-v3')
    expect(await runEvaluationCli(['--bogus', '1'], bad.io)).toBe(2)
    expect(bad.errors.join('')).toContain("unknown option '--bogus'")
  })
})

describe('the cause key of the command', () => {
  it('is the governed property-issue normalisation, so an alias agrees with its name', () => {
    expect(DEFAULT_CLI_TOOLS.causeKey('facilities_equipment', 'ac')).toBe(
      DEFAULT_CLI_TOOLS.causeKey('facilities_equipment', 'air conditioning'),
    )
    expect(DEFAULT_CLI_TOOLS.causeKey('staff_service', null)).toBe('__topic__')
  })

  it('reads the business family from the vocabulary hints', () => {
    expect(DEFAULT_CLI_TOOLS.familyOf('Hotel')).toBe('lodging')
    expect(DEFAULT_CLI_TOOLS.familyOf('Boat rental service')).toBe(
      'boat-water-activities',
    )
  })
})

describe('the harness cannot reach a provider', () => {
  const sources = readdirSync(join(ROOT, 'scripts/evaluation'))
    .filter((name) => name.endsWith('.ts') && !name.includes('.test'))
    .map(
      (name) =>
        [name, readFileSync(join(ROOT, 'scripts/evaluation', name), 'utf8')] as const,
    )

  it('makes no network call when it runs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { io } = harness()

    await runEvaluationCli(['--runs', '2', '--out', OUT], io)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    'fetch(',
    "from 'node:http",
    "from 'node:https",
    "from 'node:net",
    "from 'node:tls",
    "from 'undici'",
    '@anthropic-ai/sdk',
    "from 'openai'",
    'api.openai.com',
    'api.anthropic.com',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'process.env',
  ])('does not mention %s in any of its modules', (forbidden) => {
    const offenders = sources.filter(([, source]) => source.includes(forbidden))

    expect(offenders.map(([name]) => name)).toEqual([])
  })
})
