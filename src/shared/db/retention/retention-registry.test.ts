// LIF-01-T16 — the counsel-ready retention registry, report-only.
//
// The registry is the bullet-10 matrix. These tests are the gate that keeps it
// honest: it may not silently gain apply authority, silently drop a data class,
// or let reading a row silently extend its content deadline.

import { describe, expect, it } from 'vitest'
import { METRIC_KEYS } from '#/shared/domain/metric-keys'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import {
  assertRetentionRegistryApplyAllowed,
  DEADLINE_NEUTRAL_COLUMNS,
  LEGACY_MIRROR_PSEUDONYM_REDACTIONS,
  RETENTION_REGISTRY,
  retentionRegistryClassCoverage,
  retentionRegistryDeadlineExtensionViolations,
  retentionRegistryReportOnlyPlan,
} from './retention-registry'
import {
  RETENTION_DATA_CLASSES,
  type RetentionRegistryRule,
} from './retention-registry-model'

const ruleById = (id: string): RetentionRegistryRule => {
  const rule = RETENTION_REGISTRY.find((entry) => entry.id === id)
  if (!rule) throw new Error(`no registry rule '${id}'`)
  return rule
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Metric keys no Guest fact produces: the imported Google review aggregate and
 * the three Portal content-review measures. Every other key is the reading
 * Reporting records from a Guest visit, rating, private feedback or destination
 * selection (`record-portal-metric.ts`), so it is a second copy of that fact.
 */
const METRIC_KEYS_NOT_FROM_GUEST_FACTS: ReadonlyArray<string> = [
  'property.review',
  'portal.content_review.completed',
  'portal.configuration_completeness',
  'portal.approved_destination_ratio',
]

/** The metric keys a registry predicate names, e.g. `metric_key IN ('a', 'b')`. */
const metricKeysNamedBy = (predicate: string | null): ReadonlyArray<string> =>
  (predicate?.match(/'[^']+'/g) ?? []).map((quoted) => quoted.slice(1, -1))

describe('retention registry — matrix completeness', () => {
  it('gives every rule an owner, a source, an eligibility query, evidence and a restore implication', () => {
    const incomplete = RETENTION_REGISTRY.filter(
      (rule) =>
        rule.ownerContext.length === 0 ||
        rule.ownerRole.length === 0 ||
        rule.source.length === 0 ||
        rule.eligibility.query.length === 0 ||
        rule.eligibility.implementedBoundary.length === 0 ||
        rule.evidenceSubject.length === 0 ||
        rule.restoreImplication.length === 0,
    )
    expect(
      incomplete.map((rule) => rule.id),
      'a retention rule without an owner, source, eligibility query, evidence subject or restore implication is not reviewable by counsel',
    ).toEqual([])
  })

  it('covers every data class named in program bullet 10', () => {
    const coverage = retentionRegistryClassCoverage(RETENTION_REGISTRY)
    expect(
      coverage.uncoveredClasses,
      `program bullet 10 data classes with no retention rule: ${coverage.uncoveredClasses.join(', ')}`,
    ).toEqual([])
    expect(coverage.complete).toBe(true)
    expect(coverage.coveredCount).toBe(RETENTION_DATA_CLASSES.length)
  })

  it('fails the governance assertion when a class loses its last rule', () => {
    const withoutBackups = RETENTION_REGISTRY.filter(
      (rule) => rule.dataClass !== 'backups',
    )
    const coverage = retentionRegistryClassCoverage(withoutBackups)
    expect(coverage.uncoveredClasses).toEqual(['backups'])
    expect(coverage.complete).toBe(false)
  })

  it('gives every rule a unique id', () => {
    const ids = RETENTION_REGISTRY.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('retention registry — counsel approval', () => {
  it('defaults every rule to pending_counsel because no approval artifact exists', () => {
    const notPending = RETENTION_REGISTRY.filter(
      (rule) => rule.approvalState !== 'pending_counsel',
    )
    expect(
      notPending.map((rule) => rule.id),
      'a rule may only leave pending_counsel with a named approval artifact',
    ).toEqual([])
    expect(RETENTION_REGISTRY.every((rule) => rule.approvalArtifact === null)).toBe(true)
  })

  it('refuses apply mode while a rule is pending counsel', () => {
    for (const rule of RETENTION_REGISTRY) {
      expect(() => assertRetentionRegistryApplyAllowed(rule)).toThrowError(
        /pending_counsel/,
      )
    }
  })

  it('allows apply only once an approval artifact is attached', () => {
    const approved: RetentionRegistryRule = {
      ...ruleById('guest.private_feedback_text'),
      approvalArtifact: 'docs/legal/privacy-notice.md@approved-placeholder',
      approvalState: 'approved',
    }
    expect(() => assertRetentionRegistryApplyAllowed(approved)).not.toThrow()
  })

  it('plans report-only execution for the whole registry', () => {
    const plan = retentionRegistryReportOnlyPlan(RETENTION_REGISTRY)
    expect(plan.mode).toBe('report_only')
    expect(plan.applyBlockedRuleIds).toEqual(RETENTION_REGISTRY.map((rule) => rule.id))
    expect(plan.approvedRuleIds).toEqual([])
  })
})

describe('retention registry — §3.3.10 default horizons', () => {
  it('holds the abuse, session and network pseudonyms at exactly seven days', () => {
    for (const id of [
      'guest.abuse_pseudonym',
      'guest.session_pseudonym',
      'guest.network_pseudonym',
    ]) {
      expect(ruleById(id).eligibility.horizon, id).toEqual({ kind: 'days', days: 7 })
    }
  })

  it('holds optional contacts at exactly thirty days', () => {
    expect(ruleById('guest.optional_contact').eligibility.horizon).toEqual({
      kind: 'days',
      days: 30,
    })
  })

  it('holds private-feedback text at exactly ninety days', () => {
    expect(ruleById('guest.private_feedback_text').eligibility.horizon).toEqual({
      kind: 'days',
      days: 90,
    })
  })

  it('holds the rating fact, the counted visit and the visit record at 24 months', () => {
    for (const [id, source, anchorColumn, coveredFacts] of [
      ['guest.deidentified_facts', 'guest_responses', 'retention_deadline', ['rating']],
      [
        'guest.deidentified_qualified_scan_facts',
        'guest_qualified_scans',
        'occurred_at',
        ['qualified_scan'],
      ],
      [
        'guest.deidentified_visit_record_facts',
        'scan_events',
        'created_at',
        ['visit_record'],
      ],
    ] as const) {
      const rule = ruleById(id)
      expect(rule.source, id).toBe(source)
      expect(rule.operation ?? 'delete', id).toBe('delete')
      expect(rule.eligibility.anchorColumn, id).toBe(anchorColumn)
      expect(rule.eligibility.horizon, id).toEqual({ kind: 'months', months: 24 })
      expect(rule.coveredFacts, id).toEqual(coveredFacts)
    }
  })

  it('names every accepted horizon that no rule executes yet', () => {
    // The accepted Privacy Notice states 24 months for these classes and the
    // sweep has no rule for them (docs/BETA.md §3, UNENFORCED). A rule leaves
    // this list when its deletion ships, never by relabelling it.
    const unexecuted = RETENTION_REGISTRY.filter(
      (rule) => rule.eligibility.horizon.kind === 'accepted_unexecuted',
    ).map(({ id, source, eligibility }) => ({ id, source, horizon: eligibility.horizon }))

    expect(unexecuted).toEqual([
      {
        id: 'metric.deidentified_visit_reading_facts',
        source: 'metric_readings',
        horizon: { kind: 'accepted_unexecuted', months: 24 },
      },
      {
        id: 'metric.deidentified_response_reading_facts',
        source: 'metric_readings',
        horizon: { kind: 'accepted_unexecuted', months: 24 },
      },
      {
        id: 'metric.deidentified_destination_click_facts',
        source: 'metric_readings',
        horizon: { kind: 'accepted_unexecuted', months: 24 },
      },
      {
        id: 'ai.local_derivatives',
        source: 'ai_review_analyses',
        horizon: { kind: 'accepted_unexecuted', months: 24 },
      },
    ])
  })

  it('names every Metric reading recorded from a Guest fact, each exactly once', () => {
    // Deleting the Guest row does not delete the fact while Reporting still
    // holds the reading recorded from it: the same Portal, instant and source
    // event. Each such reading is therefore listed under the 24 months, and a
    // new metric key must be placed here or in the list of keys that are not
    // Guest facts before this passes.
    const readingRules = RETENTION_REGISTRY.filter(
      (rule) => rule.source === 'metric_readings',
    )
    const namedKeys = readingRules.flatMap((rule) =>
      metricKeysNamedBy(rule.eligibility.predicate),
    )

    expect([...namedKeys].sort()).toEqual(
      METRIC_KEYS.filter((key) => !METRIC_KEYS_NOT_FROM_GUEST_FACTS.includes(key)).sort(),
    )
    expect(readingRules.map(({ id, eligibility }) => [id, eligibility.horizon])).toEqual(
      readingRules.map(({ id }) => [id, { kind: 'accepted_unexecuted', months: 24 }]),
    )
  })

  it('says which Guest-derived readings wait for the lifetime seal and which do not', () => {
    // The seal covers the four keys the Portal lifetime aggregate is built
    // from (`portal-lifetime-aggregate.ts`). The other three feed no aggregate,
    // so "sealed first" is not what keeps them, and the entry must not say so.
    const boundaryNaming = (metricKey: string): string => {
      const rule = RETENTION_REGISTRY.find(
        (candidate) =>
          candidate.source === 'metric_readings' &&
          metricKeysNamedBy(candidate.eligibility.predicate).includes(metricKey),
      )
      if (!rule) throw new Error(`no registry rule names the metric key '${metricKey}'`)
      return rule.eligibility.implementedBoundary
    }

    for (const sealed of [
      'portal.qualified_scan',
      'portal.rating',
      'portal.feedback',
      'portal.review_link_click',
    ]) {
      expect(boundaryNaming(sealed), sealed).toContain('sealThrough')
    }
    expect(boundaryNaming('portal.scan')).toContain(
      'A portal.scan reading feeds no aggregate',
    )
    expect(boundaryNaming('portal.rating_count')).toContain(
      'portal.rating_count and portal.rating_average readings feed no aggregate',
    )
  })

  it('gives a correction no horizon apart from the reading it corrects', () => {
    const corrections = ruleById('metric.deidentified_correction_withdrawal_facts')

    expect(corrections.source).toBe('metric_corrections')
    expect(corrections.coveredFacts).toEqual(['correction', 'withdrawal'])
    expect(corrections.eligibility.horizon).toEqual({ kind: 'counsel_undecided' })
    expect(corrections.eligibility.query).toContain(
      'deleted with the reading it corrects or not at all',
    )
  })
})

describe('retention registry — compatibility mirrors', () => {
  const rulesOver = (source: string) =>
    RETENTION_REGISTRY.filter((rule) => rule.source === source).map(
      ({ id, operation }) => ({ id, operation: operation ?? 'delete' }),
    )

  it('names the mirrors the beta no longer writes only in row-preserving redactions', () => {
    for (const source of ['ratings', 'feedback']) {
      expect(rulesOver(source), source).toEqual([
        { id: `guest.legacy_${source}.abuse_pseudonym`, operation: 'redact' },
        { id: `guest.legacy_${source}.session_pseudonym`, operation: 'redact' },
      ])
    }
  })

  it('deletes from scan_events only the visit record, at the horizon of a visit fact', () => {
    expect(rulesOver('scan_events')).toEqual([
      { id: 'guest.legacy_scan_events.abuse_pseudonym', operation: 'redact' },
      { id: 'guest.legacy_scan_events.session_pseudonym', operation: 'redact' },
      { id: 'guest.deidentified_visit_record_facts', operation: 'delete' },
    ])
  })

  it('promises to keep every row only for a table no rule deletes from', () => {
    const deletedFrom = new Set(
      RETENTION_REGISTRY.filter((rule) => (rule.operation ?? 'delete') === 'delete').map(
        ({ source }) => source,
      ),
    )
    const promisesToKeepEveryRow = RETENTION_REGISTRY.filter(({ eligibility }) =>
      /retain every/i.test(eligibility.query),
    )

    expect(promisesToKeepEveryRow.map(({ id }) => id)).toEqual([
      'guest.legacy_ratings.abuse_pseudonym',
      'guest.legacy_ratings.session_pseudonym',
      'guest.legacy_feedback.abuse_pseudonym',
      'guest.legacy_feedback.session_pseudonym',
    ])
    expect(
      promisesToKeepEveryRow.filter(({ source }) => deletedFrom.has(source)),
    ).toEqual([])
  })

  it('says of each scan_events redaction which rule later deletes the row', () => {
    for (const id of [
      'guest.legacy_scan_events.abuse_pseudonym',
      'guest.legacy_scan_events.session_pseudonym',
    ]) {
      expect(ruleById(id).eligibility.query, id).toContain(
        'guest.deidentified_visit_record_facts',
      )
    }
  })
})

describe('retention registry — reading never extends a content deadline', () => {
  it('anchors every content-bearing rule on its original submission or creation column', () => {
    const violations = retentionRegistryDeadlineExtensionViolations(RETENTION_REGISTRY)
    expect(
      violations,
      'a content deadline keyed on a read, moderation or archive column restarts every time somebody opens the row',
    ).toEqual([])
  })

  it('rejects a content rule re-anchored on a read or moderation column', () => {
    for (const column of DEADLINE_NEUTRAL_COLUMNS) {
      const reanchored: RetentionRegistryRule = {
        ...ruleById('guest.private_feedback_text'),
        id: `guest.reanchored_${column}`,
        eligibility: {
          ...ruleById('guest.private_feedback_text').eligibility,
          anchorColumn: column,
        },
      }
      expect(retentionRegistryDeadlineExtensionViolations([reanchored]), column).toEqual([
        { ruleId: `guest.reanchored_${column}`, anchorColumn: column },
      ])
    }
  })

  it('keeps the executable private-feedback and contact clocks off any read column', () => {
    const privateFeedback = RETENTION_RULES.find(
      ({ subject }) => subject === 'guest_response_private_feedback.expired',
    )
    // The absolute deadline is stamped at submission; expiry reads it, so no
    // later read, moderation or archive action can move it.
    expect(privateFeedback?.tsColumn).toBe('expires_at')
    const facts = RETENTION_RULES.find(
      ({ subject }) => subject === 'guest_responses.deidentified_fact',
    )
    expect(facts?.tsColumn).toBe('retention_deadline')
  })
})

describe('retention registry — the executable sweep stays inside the registry', () => {
  it('never runs an executable rule longer than the registry horizon for its class', () => {
    const overruns: string[] = []
    for (const entry of LEGACY_MIRROR_PSEUDONYM_REDACTIONS) {
      const rule = RETENTION_RULES.find(({ subject }) => subject === entry.subject)
      const registryRule = ruleById(entry.registryRuleId)
      const horizon = registryRule.eligibility.horizon
      if (horizon.kind !== 'days') continue
      if ((rule?.olderThanMs ?? 0) > horizon.days * DAY_MS) overruns.push(entry.subject)
    }
    expect(overruns).toEqual([])
  })
})
