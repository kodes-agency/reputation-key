import { describe, expect, it } from 'vitest'
import {
  EVALUATION_HARNESS_VERSION,
  buildProviderReport,
  renderConsoleSummary,
  renderLabelsJsonl,
  renderReportHtml,
  renderReportJson,
  worstVerdict,
  type EvaluationReport,
} from './review-analysis-v3-report'
import { RELEASE_GATES_V1 } from './review-analysis-v3-gates'
import {
  acceptedResult,
  answer,
  mention,
  scoredRun,
  simpleCauseKey,
  unusableResult,
} from './review-analysis-v3.test-fixtures'

const air = mention({ topic: 'facilities_equipment', thing: 'air conditioning' })
const staff = mention({ topic: 'staff_service', thing: 'waiter', polarity: 'positive' })
const familyOf = () => 'lodging'
const tools = { causeKey: simpleCauseKey, familyOf }

const urgentGold = answer([air], { urgent: { reason: 'safety' } })

/** Three languages, one urgent review found and one quiet review per language. */
function perfectRun() {
  return ['en', 'bg', 'es'].flatMap((language) => [
    scoredRun(
      `${language}-1`,
      answer([air, staff]),
      acceptedResult(`${language}-1`, answer([air, staff])),
      {
        language,
      },
    ),
    scoredRun(
      `${language}-2`,
      answer([staff]),
      acceptedResult(`${language}-2`, answer([staff])),
      {
        language,
      },
    ),
  ])
}

function runWithMissedUrgent() {
  return [
    ...perfectRun(),
    scoredRun('en-u', urgentGold, acceptedResult('en-u', answer([air])), {
      language: 'en',
    }),
  ]
}

function reportOf(providers: EvaluationReport['providers']): EvaluationReport {
  return {
    harnessVersion: EVALUATION_HARNESS_VERSION,
    createdAt: '2026-10-30T12:00:00.000Z',
    versions: { normalizer: 'review-analysis-normalization-v1' },
    testSet: {
      digest: 'a'.repeat(64),
      items: 40,
      scored: 39,
      unsettledIds: ['cl-0021'],
      goldChangedByNormalizer: { ids: ['cl-0090'], droppedMentions: 1 },
    },
    thresholds: RELEASE_GATES_V1,
    providers,
    verdict: worstVerdict(providers.map((provider) => provider.verdict)),
  }
}

describe('worstVerdict', () => {
  it('ranks a failure over an incomplete reading over a pass', () => {
    expect(worstVerdict(['pass', 'incomplete'])).toBe('incomplete')
    expect(worstVerdict(['incomplete', 'fail', 'pass'])).toBe('fail')
    expect(worstVerdict([])).toBe('pass')
  })
})

describe('buildProviderReport', () => {
  it('reads the gates of each run and takes the worst verdict', () => {
    const report = buildProviderReport(
      { id: 'p', model: 'm' },
      [perfectRun(), runWithMissedUrgent()],
      tools,
    )

    expect(report.runs.map((run) => run.run)).toEqual([1, 2])
    // The first run has no urgent case at all, so the whole-set gates cannot be read.
    expect(report.runs[0]?.gates.verdict).toBe('incomplete')
    expect(report.runs[1]?.gates.verdict).toBe('fail')
    expect(report.verdict).toBe('fail')
  })

  it('measures how far two runs disagree, and nothing with one run', () => {
    const two = buildProviderReport(
      { id: 'p', model: 'm' },
      [perfectRun(), runWithMissedUrgent()],
      tools,
    )
    const one = buildProviderReport({ id: 'p', model: 'm' }, [perfectRun()], tools)

    expect(two.instability).toMatchObject({ items: 6 })
    expect(one.instability).toBeNull()
  })
})

describe('renderReportJson', () => {
  const provider = buildProviderReport(
    { id: 'p', model: 'm' },
    [runWithMissedUrgent()],
    tools,
  )
  const json = renderReportJson(reportOf([provider]))

  it('is valid JSON with a trailing newline', () => {
    expect(json.endsWith('\n')).toBe(true)
    expect(JSON.parse(json)).toMatchObject({
      harnessVersion: EVALUATION_HARNESS_VERSION,
      verdict: 'fail',
      testSet: { scored: 39, unsettledIds: ['cl-0021'] },
    })
  })

  it('rounds a rate to four digits and leaves counts alone', () => {
    const lopsided = buildProviderReport(
      { id: 'p', model: 'm' },
      [
        [
          scoredRun('a', answer([air]), acceptedResult('a', answer([air]))),
          scoredRun('b', answer([air]), acceptedResult('b', answer([air]))),
          scoredRun('c', answer([air]), acceptedResult('c', answer([]))),
        ],
      ],
      tools,
    )

    const parsed = JSON.parse(renderReportJson(reportOf([lopsided])))
    const micro = parsed.providers[0].runs[0].scores.gating.all.topics.micro

    expect(micro.recall).toBe(0.6667)
    expect(micro.tp).toBe(2)
    expect(parsed.testSet.items).toBe(40)
  })

  it('names reviews by id and holds no review text', () => {
    expect(json).not.toContain('The air conditioning did not work')
  })
})

describe('renderLabelsJsonl', () => {
  it('writes the final label of each review, one line each', () => {
    const lines = renderLabelsJsonl([
      acceptedResult('a', answer([air]), { flags: ['enum_case_repaired'] }),
      unusableResult('b', 'refused'),
    ])
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(lines).toEqual([
      {
        id: 'a',
        status: 'accepted',
        flags: ['enum_case_repaired'],
        droppedMentionCount: 0,
        answer: answer([air]),
      },
      { id: 'b', status: 'refused', flags: [], droppedMentionCount: 0, answer: null },
    ])
  })

  it('writes nothing for no reviews', () => {
    expect(renderLabelsJsonl([])).toBe('')
  })
})

describe('renderReportHtml', () => {
  const hostile = buildProviderReport(
    { id: '<img src=x onerror=alert(1)>', model: 'm"' },
    [perfectRun()],
    tools,
  )
  const html = renderReportHtml({
    ...reportOf([hostile]),
    testSet: { ...reportOf([hostile]).testSet, unsettledIds: ['<b>cl-0021</b>'] },
  })

  it('is a whole page with the verdict', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Review analysis v3 evaluation:')
    expect(html).toContain('incomplete')
  })

  it('shows every gate in every gating slice', () => {
    for (const gate of ['urgent recall', 'topic micro f1', 'thing agreement']) {
      expect(html).toContain(gate)
    }
    expect(html).toContain('<th>bg</th>')
  })

  it('says which gates could not be measured', () => {
    expect(html).toContain('Not measurable here:')
  })

  it('escapes everything it was given', () => {
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>cl-0021</b>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<script')
  })
})

describe('renderConsoleSummary', () => {
  it('prints the verdict and one line per gating slice, marking a failed gate', () => {
    const provider = buildProviderReport(
      { id: 'p', model: 'm' },
      [runWithMissedUrgent()],
      tools,
    )

    const text = renderConsoleSummary(reportOf([provider]))
    const lines = text.trimEnd().split('\n')

    expect(lines[0]).toBe('review analysis v3 evaluation: FAIL')
    expect(lines[1]).toBe('39 of 40 reviews scored, 1 without gold')
    expect(lines).toContain('p (m): fail')
    expect(lines.filter((line) => line.startsWith('    '))).toHaveLength(4)
    expect(text).toContain('urgent_safety_health_misses 1 FAIL')
    expect(text).toContain('urgent_recall 0.000 FAIL')
  })
})
