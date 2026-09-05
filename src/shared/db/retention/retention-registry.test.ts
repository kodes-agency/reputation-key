// LIF-01-T16 — the counsel-ready retention registry, report-only.
//
// The registry is the bullet-10 matrix. These tests are the gate that keeps it
// honest: it may not silently gain apply authority, it may not silently drop a
// data class, it may not silently start deleting from a compatibility mirror,
// and reading a row may not silently extend its content deadline.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contractionCandidateTableNames } from '#/shared/governance/contraction-inventory-registry'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import {
  assertRetentionRegistryApplyAllowed,
  DEADLINE_NEUTRAL_COLUMNS,
  LEGACY_MIRROR_PSEUDONYM_REDACTIONS,
  RETENTION_DATA_CLASSES,
  RETENTION_REGISTRY,
  retentionRegistryClassCoverage,
  retentionRegistryContractionViolations,
  retentionRegistryDeadlineExtensionViolations,
  retentionRegistryReportOnlyPlan,
  type RetentionRegistryRule,
} from './retention-registry'

const ROOT = join(import.meta.dirname, '../../../..')

const ruleById = (id: string): RetentionRegistryRule => {
  const rule = RETENTION_REGISTRY.find((entry) => entry.id === id)
  if (!rule) throw new Error(`no registry rule '${id}'`)
  return rule
}

const DAY_MS = 24 * 60 * 60 * 1000

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

  it('names an open counsel decision for every pending rule', () => {
    const checklist = JSON.parse(
      readFileSync(join(ROOT, 'docs/legal/counsel-decision-checklist.json'), 'utf8'),
    ) as { items: ReadonlyArray<{ id: string; status: string }> }
    const openIds = new Set(
      checklist.items.filter(({ status }) => status === 'open').map(({ id }) => id),
    )
    const unreferenced = RETENTION_REGISTRY.filter(
      (rule) =>
        rule.blockingCounselDecisions.length === 0 ||
        rule.blockingCounselDecisions.some((id) => !openIds.has(id)),
    )
    expect(
      unreferenced.map((rule) => rule.id),
      'every pending rule must cite a real, still-open counsel decision',
    ).toEqual([])
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

  it('keeps the live rating fact at 24 months and marks separately stored facts undecided', () => {
    const facts = ruleById('guest.deidentified_facts')
    expect(facts.eligibility.horizon).toEqual({ kind: 'months', months: 24 })
    expect(facts.coveredFacts).toEqual(['rating'])

    for (const [id, source, coveredFacts] of [
      [
        'guest.deidentified_qualified_scan_facts',
        'guest_qualified_scans',
        ['qualified_scan'],
      ],
      [
        'metric.deidentified_destination_click_facts',
        'metric_readings',
        ['destination_click'],
      ],
      [
        'metric.deidentified_correction_withdrawal_facts',
        'metric_corrections',
        ['correction', 'withdrawal'],
      ],
    ] as const) {
      const rule = ruleById(id)
      expect(rule.source, id).toBe(source)
      expect(rule.eligibility.horizon, id).toEqual({ kind: 'counsel_undecided' })
      expect(rule.coveredFacts, id).toEqual(coveredFacts)
    }
  })
})

describe('retention registry — compatibility mirrors are untouchable', () => {
  const candidates = contractionCandidateTableNames()

  it('resolves the contraction candidates it is guarding against', () => {
    expect(candidates).toContain('feedback')
    expect(candidates).toContain('ratings')
    expect(candidates).toContain('scan_events')
    expect(candidates).toContain('gbp_cache')
    expect(candidates).toContain('portal_group_members')
  })

  it('allows only row-preserving redactions against contraction candidates', () => {
    const violations = retentionRegistryContractionViolations(
      RETENTION_REGISTRY,
      candidates,
    )
    expect(
      violations,
      'a deleting retention rule over a contraction candidate would perform the contraction early, before the one verified release plus restore proof that gates it',
    ).toEqual([])
  })

  it('detects a rule that starts targeting a mirror', () => {
    const smuggled: RetentionRegistryRule = {
      ...ruleById('guest.private_feedback_text'),
      id: 'guest.smuggled_mirror',
      source: 'feedback',
    }
    expect(retentionRegistryContractionViolations([smuggled], candidates)).toEqual([
      { ruleId: 'guest.smuggled_mirror', source: 'feedback' },
    ])
  })

  it('is not fooled by a mirror relabelled as an object store', () => {
    const relabelled: RetentionRegistryRule = {
      ...ruleById('guest.private_feedback_text'),
      id: 'guest.relabelled_mirror',
      sourceKind: 'object_store',
      source: 'scan_events',
    }
    expect(retentionRegistryContractionViolations([relabelled], candidates)).toEqual([
      { ruleId: 'guest.relabelled_mirror', source: 'scan_events' },
    ])
  })

  it('rejects an overbroad redaction against a compatibility mirror', () => {
    const overbroad: RetentionRegistryRule = {
      ...ruleById('guest.legacy_feedback.abuse_pseudonym'),
      redactColumns: ['comment'],
    }
    expect(retentionRegistryContractionViolations([overbroad], candidates)).toEqual([
      {
        ruleId: 'guest.legacy_feedback.abuse_pseudonym',
        source: 'feedback',
      },
    ])
  })

  it('never deletes from a contraction candidate in the executable sweep either', () => {
    const deleting = RETENTION_RULES.filter(
      (rule) =>
        (rule.operation ?? 'delete') === 'delete' && candidates.includes(rule.table),
    )
    expect(
      deleting.map((rule) => rule.subject),
      'the scheduled sweep must not delete rows a contraction decision still depends on',
    ).toEqual([])
  })

  it('declares every surviving legacy-mirror pseudonym redaction as row-preserving', () => {
    const redactingMirrorSubjects = RETENTION_RULES.filter((rule) =>
      candidates.includes(rule.table),
    ).map((rule) => rule.subject)
    expect(redactingMirrorSubjects.sort()).toEqual(
      LEGACY_MIRROR_PSEUDONYM_REDACTIONS.map(({ subject }) => subject).sort(),
    )
    for (const entry of LEGACY_MIRROR_PSEUDONYM_REDACTIONS) {
      const rule = RETENTION_RULES.find(({ subject }) => subject === entry.subject)
      expect(rule?.operation, entry.subject).toBe('redact')
      expect(rule?.table, entry.subject).toBe(entry.table)
      const registryRule = RETENTION_REGISTRY.find(
        (candidate) =>
          candidate.source === entry.table && candidate.evidenceSubject === entry.subject,
      )
      expect(registryRule?.operation, entry.subject).toBe('redact')
      expect(registryRule?.redactColumns, entry.subject).toEqual([entry.redactedColumn])
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
