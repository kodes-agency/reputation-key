import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('product-state remount boundaries', () => {
  it('replaces profile and organization image drafts when server identity changes', () => {
    expect(source('src/routes/_authenticated/settings/profile.tsx')).toContain(
      'key={`${ctx.user.id}:${ctx.user.name}:${ctx.user.image',
    )
    expect(
      source('src/components/features/organization/organization-settings-page.tsx'),
    ).toContain("key={organization.logo ?? 'no-logo'}")
  })

  it('pins the other server-draft remount owners recorded by the ledger', () => {
    expect(source('src/routes/_authenticated/properties/$propertyId.tsx')).toContain(
      '<Outlet key={propertyId} />',
    )
    expect(source('src/routes/p/$token.tsx')).toContain(
      '<PublicPortalView key={token} token={token} data={data} />',
    )
    expect(source('src/components/inbox/inbox-detail-content.tsx')).toContain(
      '<ReplyEditor\n                key={currentItem.id}',
    )
    expect(source('src/components/features/property/property-dashboard.tsx')).toContain(
      'key={`${propertyId}:${performanceRange}`}',
    )
    expect(
      source('src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx'),
    ).toContain('<PageShell key={`${propertyId}:${goalId}`}>')
    expect(
      source('src/routes/_authenticated/properties/import-google/$importId.tsx'),
    ).toContain('key={importId}')
    expect(
      source('src/components/features/organization/organization-settings-page.tsx'),
    ).toContain('key={responseSlaHours}')
    expect(
      source('src/components/features/organization/organization-settings-page.tsx'),
    ).toContain(
      "key={`${organization.name}:${organization.slug}:${organization.contactEmail ?? 'no-contact-email'}`}",
    )
    expect(source('src/routes/_authenticated/settings/ai.tsx')).toContain(
      "key={propertyId ?? 'no-property'}",
    )
    expect(source('src/routes/_authenticated/settings/notifications.tsx')).toContain(
      'notificationPropertyScopeKey(properties.properties)',
    )
    expect(
      source('src/components/features/settings/notifications-category-row.tsx'),
    ).toContain('key={`${category}:${email?.quietHoursStart}:${email?.quietHoursEnd}`}')
    const portalExperienceSettings = source(
      'src/components/features/portal/portal-settings/portal-experience-settings-card.tsx',
    )
    expect(portalExperienceSettings).toContain('key={portalLocaleDraftKey(portal)}')
    expect(portalExperienceSettings).toContain('key={portalBrandDraftKey(experience)}')
    expect(portalExperienceSettings).toContain(
      'key={portalLocalizedContentDraftKey(experience, locale)}',
    )
  })
})
