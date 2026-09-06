import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALERT_DEFINITIONS } from './alert-definitions'
import { REG04_PLATFORM_SIGNALS } from './regional-platform-signals'
import {
  BETA_CRITICAL_JOURNEY_SIGNALS,
  BETA_SUPPORT_POLICY,
  OBS01_EXTERNAL_EVIDENCE_GATES,
} from './beta-support-operations'

describe('OBS-01 beta support operations authority', () => {
  it('covers every closed-beta critical journey', () => {
    expect(BETA_CRITICAL_JOURNEY_SIGNALS.map((signal) => signal.journey).sort()).toEqual(
      [
        'beta_feedback_delivery',
        'beta_feedback_triage',
        'google_connection_and_import',
        'google_review_sync',
        'invitation_and_onboarding',
        'portal_review_gateway',
        'reply_publish_and_reconcile',
        'review_and_inbox_triage',
      ].sort(),
    )
  })

  it('links local signals to real alert definitions and external signals to honest evidence gates', () => {
    const applicationAlerts = new Set(
      ALERT_DEFINITIONS.filter((alert) => alert.implemented).map((alert) => alert.name),
    )
    const externalSignals = new Set(REG04_PLATFORM_SIGNALS.map((signal) => signal.name))

    for (const signal of BETA_CRITICAL_JOURNEY_SIGNALS) {
      expect(signal.owner).toBe('Bozhidar Denev')
      expect(signal.runbook).toBe('runbooks.md §16')
      expect(signal.evidence.length).toBeGreaterThan(0)
      if (signal.status === 'implemented_application_signal') {
        expect(applicationAlerts.has(signal.signalName), signal.journey).toBe(true)
      } else if (signal.status === 'registered_external_signal') {
        expect(externalSignals.has(signal.signalName), signal.journey).toBe(true)
      } else {
        expect(signal.signalName).toMatch(/^cell-us\.journey\./u)
      }
    }
  })

  it('uses the content-free local triage alert without claiming external delivery', () => {
    expect(
      BETA_CRITICAL_JOURNEY_SIGNALS.find(
        (signal) => signal.journey === 'beta_feedback_triage',
      ),
    ).toMatchObject({
      signalName: 'beta-feedback.triage-backlog',
      status: 'implemented_application_signal',
      severity: 'P2',
      evidence: [
        'content_free_queue_age_signal',
        'named_owner_coverage',
        'local_alert_injection_test',
      ],
    })
    expect(
      OBS01_EXTERNAL_EVIDENCE_GATES.find((gate) => gate.id === 'alert_delivery_drill'),
    ).toMatchObject({
      status: 'external_evidence_required',
      repositoryProofIsSufficient: false,
    })
  })

  it('keeps support ownership, regular response expectations, and urgent incident handoff explicit', () => {
    expect(BETA_SUPPORT_POLICY).toMatchObject({
      intake: 'native_beta_feedback',
      triageOwner: 'Bozhidar Denev',
      incidentCommander: 'Bozhidar Denev',
      communicationsOwner: 'Bozhidar Denev',
      regularResponseExpectation: 'next_business_day',
      regularResponseIsGuarantee: false,
    })
    expect(BETA_SUPPORT_POLICY.immediateIncidentHandoff).toEqual([
      'privacy_escalated',
      'security_suspected',
      'security_confirmed',
      'critical_journey_unavailable',
    ])
    expect(BETA_SUPPORT_POLICY.afterHoursContainment).toEqual([
      'disable_affected_non_core_capability',
      'suspend_affected_property_processing',
      'pause_affected_queue_without_deleting_work',
      'roll_back_to_last_signed_release',
    ])
  })

  it('keeps every provider, legal, and deployed proof visibly external', () => {
    expect(OBS01_EXTERNAL_EVIDENCE_GATES.map((gate) => gate.id).sort()).toEqual(
      [
        'alert_delivery_drill',
        'germany_project_inspection',
        'inbound_scrubber_inspection',
        'legal_notice_and_retention_approval',
        'manual_attachment_journey',
        'per_process_cell_test_events',
        'provider_attachment_retention',
        'source_map_inspection',
      ].sort(),
    )
    for (const gate of OBS01_EXTERNAL_EVIDENCE_GATES) {
      expect(gate.status).toBe('external_evidence_required')
      expect(gate.repositoryProofIsSufficient).toBe(false)
    }
  })

  it('keeps the consent, durable receipt, triage, and support contract executable in the runbook', () => {
    const runbook = readFileSync('docs/operations/runbooks.md', 'utf8')
    expect(runbook).toContain('checking the consent box does not capture anything')
    expect(runbook).toContain('local UUID receipt')
    expect(runbook).toContain('pnpm ops:triage-beta-feedback')
    expect(runbook).toMatch(/next business day is an\s+expectation, not a guarantee/u)
    expect(runbook).toContain('ordinary screenshot or Replay payload')
    expect(runbook).toContain('external evidence required')
  })
})
