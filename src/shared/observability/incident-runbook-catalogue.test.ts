import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REG04_INCIDENT_RUNBOOKS } from './incident-runbook-catalogue'

describe('REG-04 incident runbook catalogue', () => {
  it('covers every required incident class with named operating roles', () => {
    expect(REG04_INCIDENT_RUNBOOKS.map((row) => row.id).sort()).toEqual(
      [
        'auth_compromise',
        'bad_migration',
        'cross_tenant_suspicion',
        'google_ambiguous_publish',
        'lost_bucket_object',
        'privacy_request',
        'provider_credential_leak',
        'queue_outbox_stall',
        'us_regional_outage',
      ].sort(),
    )

    for (const row of REG04_INCIDENT_RUNBOOKS) {
      expect(row.incidentCommander).toBe('Bozhidar Denev')
      expect(row.communicationsSupportOwner).toBe('Bozhidar Denev')
      expect(row.runbook).toMatch(/^runbooks\.md §\d+$/u)
      expect(row.evidence.length).toBeGreaterThan(0)
    }
  })

  it('keeps every referenced section and the explicit role policy executable in the runbook', () => {
    const runbooks = readFileSync('docs/operations/runbooks.md', 'utf8')
    const sections = new Set(
      [...runbooks.matchAll(/^## (\d+)\. /gmu)].map(
        (match) => `runbooks.md §${match[1]}`,
      ),
    )
    for (const row of REG04_INCIDENT_RUNBOOKS) {
      expect(sections.has(row.runbook), `${row.id} → ${row.runbook}`).toBe(true)
    }
    expect(runbooks).toContain('**Default incident commander: Bozhidar Denev.**')
    expect(runbooks).toContain(
      '**Default communications/support owner: Bozhidar Denev.**',
    )
    expect(runbooks).toContain('Cross-Tenant Isolation Suspicion')
    expect(runbooks).toContain('Lost Bucket Object')
    expect(runbooks).toContain('Privacy Request Incident')
  })

  it('keeps every incident procedure complete rather than a title-only pointer', () => {
    const runbooks = readFileSync('docs/operations/runbooks.md', 'utf8')
    for (const row of REG04_INCIDENT_RUNBOOKS) {
      const section = Number(row.runbook.slice('runbooks.md §'.length))
      const start = runbooks.search(new RegExp(`^## ${section}\\. `, 'mu'))
      expect(start, row.id).toBeGreaterThanOrEqual(0)
      const remaining = runbooks.slice(start)
      const next = remaining.slice(1).search(/^## \d+\. /mu)
      const body = next < 0 ? remaining : remaining.slice(0, next + 1)

      expect(body, `${row.id}: trigger`).toMatch(/\*\*Trigger(?:\/Symptoms)?:\*\*/u)
      expect(body, `${row.id}: impact`).toContain('**Impact:**')
      expect(body, `${row.id}: prerequisites`).toContain('**Prerequisites:**')
      expect(body, `${row.id}: diagnostics`).toContain('**Diagnostics:**')
      expect(body, `${row.id}: containment`).toContain('**Containment:**')
      expect(body, `${row.id}: recovery`).toContain('**Recovery:**')
      expect(body, `${row.id}: verification`).toContain('**Verification:**')
      expect(body, `${row.id}: escalation`).toMatch(/\*\*Escalation(?:\/Evidence)?:\*\*/u)
      expect(body, `${row.id}: evidence`).toMatch(
        /\*\*(?:Evidence|Escalation\/Evidence):\*\*/u,
      )
    }
  })
})
