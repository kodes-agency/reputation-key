// The artifacts of a review-analysis v3 evaluation (contract section 8): a JSON
// report, a self-contained HTML page, the final normalized label of every review
// in every run, and the lines the command prints. They name reviews by id and
// hold counts, rates and topic ids. They never hold a review's text, a provider's
// raw answer or a request, so a report from the live slice can be shared.

import {
  evaluateGates,
  GATE_IDS,
  GATING_SLICES,
  RELEASE_GATES_V1,
  type GateReport,
  type GateResult,
  type GateVerdict,
} from './review-analysis-v3-gates'
import type { CauseKey } from './review-analysis-v3-mention-metrics'
import {
  compareRuns,
  type RunInstability,
  type ScoredRun,
} from './review-analysis-v3-metrics'
import type { ItemRunResult } from './review-analysis-v3-provider'
import { scoreSlices, type SliceScores } from './review-analysis-v3-slices'
import { rounded, type Rate } from './review-analysis-v3-stats'

export const EVALUATION_HARNESS_VERSION = 'review-analysis-v3-evaluation-v1'

export type RunReport = Readonly<{ run: number; scores: SliceScores; gates: GateReport }>

export type ProviderReport = Readonly<{
  id: string
  model: string
  runs: readonly RunReport[]
  /** Between the first two runs; null when there is one. */
  instability: RunInstability | null
  /** The worst verdict of its runs: a provider passes only if every run does. */
  verdict: GateVerdict
}>

export type EvaluationReport = Readonly<{
  harnessVersion: typeof EVALUATION_HARNESS_VERSION
  createdAt: string
  /** The versions and digests the numbers were measured against. */
  versions: Readonly<Record<string, string>>
  testSet: Readonly<{
    digest: string
    items: number
    scored: number
    unsettledIds: readonly string[]
    /** Reviews the redactor changed before the provider read them. */
    redactionChangedIds: readonly string[]
    /** Reviews the live path would not send at all (source or redaction refused). */
    notSentIds: readonly string[]
    /** Gold labels the production normalizer would not accept as written. */
    goldChangedByNormalizer: Readonly<{
      ids: readonly string[]
      droppedMentions: number
    }>
  }>
  thresholds: typeof RELEASE_GATES_V1
  providers: readonly ProviderReport[]
  verdict: GateVerdict
}>

const VERDICT_RANK: Readonly<Record<GateVerdict, number>> = {
  pass: 0,
  incomplete: 1,
  fail: 2,
}

export function worstVerdict(verdicts: readonly GateVerdict[]): GateVerdict {
  return verdicts.reduce<GateVerdict>(
    (worst, verdict) => (VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst),
    'pass',
  )
}

/** Score every run of one provider and read the gates of each. */
export function buildProviderReport(
  provider: Readonly<{ id: string; model: string }>,
  runs: readonly (readonly ScoredRun[])[],
  tools: Readonly<{ causeKey: CauseKey; familyOf: (business: string) => string }>,
): ProviderReport {
  const reports = runs.map((scored, index): RunReport => {
    const scores = scoreSlices(scored, tools.causeKey, tools.familyOf)
    return Object.freeze({ run: index + 1, scores, gates: evaluateGates(scores.gating) })
  })
  const [first, second] = runs
  const instability =
    first === undefined || second === undefined
      ? null
      : compareRuns(
          first.map((one) => one.result),
          second.map((one) => one.result),
        )
  return Object.freeze({
    id: provider.id,
    model: provider.model,
    runs: Object.freeze(reports),
    instability,
    verdict: worstVerdict(reports.map((report) => report.gates.verdict)),
  })
}

function roundForReport(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? rounded(value) : value
}

export function renderReportJson(report: EvaluationReport): string {
  return `${JSON.stringify(report, roundForReport, 2)}\n`
}

/** One line per review: its final normalized label, never the provider's envelope. */
export function renderLabelsJsonl(results: readonly ItemRunResult[]): string {
  return results
    .map((result) =>
      JSON.stringify({
        id: result.itemId,
        status: result.status,
        flags: result.flags,
        droppedMentionCount: result.droppedMentionCount,
        answer: result.answer,
      }),
    )
    .join('\n')
    .concat(results.length === 0 ? '' : '\n')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatRate(value: Rate): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

/** The one gate that counts reviews instead of reading a rate. */
const COUNT_GATE: GateResult['gate'] = 'urgent_safety_health_misses'

function formatGateValue(result: GateResult): string {
  if (result.value === null) return 'n/a'
  return result.gate === COUNT_GATE ? String(result.value) : result.value.toFixed(3)
}

function gateCell(result: GateResult | undefined): string {
  if (result === undefined) return '<td></td>'
  const label = result.status === 'not_measurable' ? 'not measurable' : result.status
  return `<td class="${result.status}" title="${escapeHtml(result.note)}">${escapeHtml(
    formatGateValue(result),
  )} <small>${label}</small></td>`
}

function gateTable(gates: GateReport): string {
  const head = GATING_SLICES.map((slice) => `<th>${slice}</th>`).join('')
  const rows = GATE_IDS.map((gate) => {
    const cells = GATING_SLICES.map((slice) =>
      gateCell(gates.results.find((one) => one.gate === gate && one.slice === slice)),
    ).join('')
    return `<tr><th scope="row">${gate.replaceAll('_', ' ')}</th>${cells}</tr>`
  }).join('')
  return `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

function topicTable(run: RunReport): string {
  const rows = Object.entries(run.scores.gating.all.topics.perTopic)
    .map(
      ([topic, stat]) =>
        `<tr><th scope="row">${escapeHtml(topic)}</th><td>${stat.support}</td><td>${formatRate(
          stat.f1,
        )}</td><td>${formatRate(stat.precision)}</td><td>${formatRate(stat.recall)}</td></tr>`,
    )
    .join('')
  return `<table><thead><tr><th>topic</th><th>reviews</th><th>F1</th><th>precision</th><th>recall</th></tr></thead><tbody>${rows}</tbody></table>`
}

function contextTable(run: RunReport): string {
  const rows = Object.entries(run.scores.context)
    .map(
      ([name, one]) =>
        `<tr><th scope="row">${escapeHtml(name)}</th><td>${one.items}</td><td>${formatRate(
          one.sentimentAccuracy,
        )}</td><td>${formatRate(one.topicMicroF1)}</td><td>${formatRate(
          one.thingAgreement,
        )}</td><td>${formatRate(one.urgentRecall)}</td><td>${formatRate(
          one.falseUrgentRate,
        )}</td></tr>`,
    )
    .join('')
  return `<table><thead><tr><th>slice</th><th>reviews</th><th>sentiment</th><th>topic F1</th><th>thing</th><th>urgent recall</th><th>false urgent</th></tr></thead><tbody>${rows}</tbody></table>`
}

function runSection(provider: ProviderReport, run: RunReport): string {
  const all = run.scores.gating.all
  const unmeasured = run.gates.unmeasured
    .map((one) => `${one.slice} ${one.gate.replaceAll('_', ' ')}`)
    .join(', ')
  return `<section><h3>${escapeHtml(provider.id)} run ${run.run}: <span class="${
    run.gates.verdict
  }">${run.gates.verdict}</span></h3>${gateTable(run.gates)}${
    unmeasured === ''
      ? ''
      : `<p class="note">Not measurable here: ${escapeHtml(unmeasured)}.</p>`
  }<p>Usable answers ${formatRate(all.robustness.usableRate)}, sentiment accuracy ${formatRate(
    all.sentiment.accuracy,
  )}, polarity ${formatRate(all.mentions.polarityAccuracy)}, strength ${formatRate(
    all.mentions.strengthAccuracy,
  )}, evidence F1 ${formatRate(all.mentions.evidence.f1)}, names recall (team member) ${formatRate(
    all.mentions.names.teamMember.recall,
  )} with ${all.mentions.names.privacyCriticalMisses} privacy-critical misses.</p><details><summary>Topics</summary>${topicTable(
    run,
  )}</details><details><summary>Other slices</summary>${contextTable(run)}</details></section>`
}

const PAGE_STYLE =
  'body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem;color:#1b1b1b}' +
  'table{border-collapse:collapse;margin:.5rem 0 1rem}th,td{border:1px solid #c9c9c9;padding:.25rem .6rem;text-align:left}' +
  'td small{color:#555}.pass{color:#1b6b2f}.fail{color:#b3261e;font-weight:600}.incomplete,.not_measurable{color:#8a5a00}' +
  '.note{color:#555}summary{cursor:pointer}'

export function renderReportHtml(report: EvaluationReport): string {
  const providers = report.providers
    .map(
      (provider) =>
        `<h2>${escapeHtml(provider.id)} (${escapeHtml(provider.model)}): <span class="${
          provider.verdict
        }">${provider.verdict}</span></h2>${provider.runs
          .map((run) => runSection(provider, run))
          .join('')}${
          provider.instability === null
            ? ''
            : `<p>Between runs 1 and 2, ${provider.instability.differentLabels} of ${provider.instability.items} labels differ.</p>`
        }`,
    )
    .join('')
  const versions = Object.entries(report.versions)
    .map(
      ([name, value]) =>
        `<li>${escapeHtml(name)}: <code>${escapeHtml(value)}</code></li>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Review analysis v3 evaluation</title><style>${PAGE_STYLE}</style></head><body><h1>Review analysis v3 evaluation: <span class="${
    report.verdict
  }">${report.verdict}</span></h1><p class="note">${escapeHtml(report.createdAt)}. ${
    report.testSet.scored
  } of ${report.testSet.items} reviews scored; ${report.testSet.unsettledIds.length} wait for a gold label${
    report.testSet.unsettledIds.length === 0
      ? ''
      : ` (${escapeHtml(report.testSet.unsettledIds.join(', '))})`
  }. The redactor changed ${report.testSet.redactionChangedIds.length} reviews${
    report.testSet.redactionChangedIds.length === 0
      ? ''
      : ` (${escapeHtml(report.testSet.redactionChangedIds.join(', '))})`
  } and ${report.testSet.notSentIds.length} were not sent${
    report.testSet.notSentIds.length === 0
      ? ''
      : ` (${escapeHtml(report.testSet.notSentIds.join(', '))})`
  }.</p><ul>${versions}</ul>${providers}</body></html>\n`
}

function consoleGate(result: GateResult): string {
  const mark = { pass: 'ok', fail: 'FAIL', not_measurable: 'n/a' }[result.status]
  return `${result.gate} ${formatGateValue(result)} ${mark}`
}

/** What the command prints: the verdict, then one line per gating slice. */
export function renderConsoleSummary(report: EvaluationReport): string {
  const lines = [
    `review analysis v3 evaluation: ${report.verdict.toUpperCase()}`,
    `${report.testSet.scored} of ${report.testSet.items} reviews scored, ${report.testSet.unsettledIds.length} without gold`,
  ]
  for (const provider of report.providers) {
    lines.push(`${provider.id} (${provider.model}): ${provider.verdict}`)
    for (const run of provider.runs) {
      lines.push(`  run ${run.run}: ${run.gates.verdict}`)
      for (const slice of GATING_SLICES) {
        const results = run.gates.results.filter((one) => one.slice === slice)
        lines.push(`    ${slice.padEnd(3)} ${results.map(consoleGate).join(' | ')}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}
