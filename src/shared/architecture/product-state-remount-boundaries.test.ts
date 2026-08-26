import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('product-state remount boundaries', () => {
  it('replaces profile and organization image drafts when server identity changes', () => {
    expect(source('src/routes/_authenticated/settings/profile.tsx')).toContain(
      'key={`${ctx.user.id}:${ctx.user.image',
    )
    expect(
      source('src/components/features/organization/organization-settings-page.tsx'),
    ).toContain("key={organization.logo ?? 'no-logo'}")
  })

  it('pins the other server-draft remount owners recorded by the ledger', () => {
    expect(
      source('src/components/features/organization/organization-settings-page.tsx'),
    ).toContain('key={responseSlaHours}')
    expect(source('src/routes/_authenticated/settings/ai.tsx')).toContain(
      "key={propertyId ?? 'no-property'}",
    )
    expect(source('src/routes/_authenticated/settings/notifications.tsx')).toContain(
      'notificationPropertyScopeKey(properties.properties)',
    )
    expect(
      source('src/components/features/settings/notifications-category-row.tsx'),
    ).toContain('key={`${category}:${email?.quietHoursStart}:${email?.quietHoursEnd}`}')
  })
})
