import { describe, expect, it } from 'vitest'
import {
  REG04_MONITORING_REQUIREMENTS,
  REG04_PLATFORM_SIGNALS,
  REG04_SIDECAR_SERVICES,
} from './regional-platform-signals'
import { ALERT_DEFINITIONS } from './alert-definitions'
import { BETA_DEPLOYMENT_DATA_CELL_IDS } from '#/shared/domain/data-cell-catalogue'

describe('REG-04 regional platform signal authority', () => {
  it('covers the exact one-cell beta without manufacturing dormant-cell monitors', () => {
    expect(BETA_DEPLOYMENT_DATA_CELL_IDS).toEqual(['us'])
    expect(new Set(REG04_PLATFORM_SIGNALS.map((signal) => signal.dataCellId))).toEqual(
      new Set(['us']),
    )
    expect(REG04_PLATFORM_SIGNALS.some((signal) => signal.name.includes('europe'))).toBe(
      false,
    )
    expect(REG04_PLATFORM_SIGNALS.some((signal) => signal.name.includes('global'))).toBe(
      false,
    )
  })

  it('registers every platform-owned backup, recovery, error, and drift signal', () => {
    expect(REG04_PLATFORM_SIGNALS.map((signal) => signal.name).sort()).toEqual(
      [
        'cell-us.backup.latest-success-age',
        'cell-us.error-monitoring.error-rate',
        'cell-us.logical-export.latest-success-age',
        'cell-us.pitr.restore-range',
        'cell-us.pitr.wal-health',
        'cell-us.release.config-drift',
        'cell-us.sidecar.ai-egress-gateway.readiness',
        'cell-us.sidecar.ai-execution-admission.readiness',
        'cell-us.sidecar.google-egress-gateway.readiness',
        'cell-us.sidecar.google-execution-admission.readiness',
        'cell-us.web.external-availability',
      ].sort(),
    )
  })

  it('requires independent post-boot readiness for every retained mTLS sidecar', () => {
    const readiness = REG04_PLATFORM_SIGNALS.filter(
      (signal) => signal.kind === 'sidecar_readiness',
    )
    expect(readiness.map((signal) => signal.service).sort()).toEqual(
      [...REG04_SIDECAR_SERVICES].sort(),
    )
    for (const signal of readiness) {
      expect(signal.source).toBe('external_synthetic')
      expect(signal.path).toBe('/health/ready')
      expect(signal.requiresDistinctNonMtlsPort).toBe(true)
      expect(signal.evidence).toContain('post_boot_dependency_loss')
    }
  })

  it('maps every program monitoring requirement to one implemented or external signal', () => {
    const appAlerts = new Map(ALERT_DEFINITIONS.map((alert) => [alert.name, alert]))
    const externalSignals = new Set(REG04_PLATFORM_SIGNALS.map((signal) => signal.name))

    expect(REG04_MONITORING_REQUIREMENTS.map((row) => row.requirement).sort()).toEqual(
      [
        'backup_age',
        'cell_release_config_drift',
        'error_rate',
        'google_sync_freshness',
        'logical_export_success',
        'outbox_lag',
        'queue_age',
        'reply_publication',
        'restore_range',
        'wal_pitr_health',
      ].sort(),
    )

    for (const row of REG04_MONITORING_REQUIREMENTS) {
      if (row.source === 'application_alert') {
        const alert = appAlerts.get(row.signal)
        expect(alert, row.requirement).toBeDefined()
        expect(alert?.implemented, row.requirement).toBe(true)
      } else {
        expect(externalSignals.has(row.signal), row.requirement).toBe(true)
      }
    }
  })

  it('gives each external signal an owner, severity, executable runbook, and retained evidence requirement', () => {
    for (const signal of REG04_PLATFORM_SIGNALS) {
      expect(signal.owner).toBe('Bozhidar Denev')
      expect(signal.severity).toMatch(/^P[0-3]$/u)
      expect(signal.runbook).toMatch(/^runbooks\.md §\d+$/u)
      expect(signal.evidence.length).toBeGreaterThan(0)
      expect(signal.activationGate).toBe('required_before_customer_data')
    }
  })
})
