import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('organization response policy boundaries', () => {
  it('keeps the review-attention SLA separate from Inbox response targets', () => {
    const route = source('src/routes/_authenticated/settings/organization.tsx')
    const page = source(
      'src/components/features/organization/organization-settings-page.tsx',
    )
    const propertyDashboard = source('src/contexts/dashboard/server/dashboard.ts')
    const fleetDashboard = source('src/contexts/dashboard/server/fleet-overview.ts')

    expect(route).toContain('getOrgResponseSlaFn')
    expect(route).toContain('getResponseTargetPolicySettingsFn')
    expect(page).toContain('<ResponseSlaCard')
    expect(page).toContain('<ResponseTargetSettingsCard')
    expect(propertyDashboard).toContain('extractResponseSlaHours')
    expect(fleetDashboard).toContain('extractResponseSlaHours')
  })
})
