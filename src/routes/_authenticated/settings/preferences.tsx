import { getProductUpdatesClient } from '../-product-updates-client'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { ProductUpdatePreferences } from '#/components/features/whats-new/product-update-preferences'
import { PreferencesSettingsPage } from '#/components/features/settings'

export const Route = createFileRoute('/_authenticated/settings/preferences')({
  staticData: { page: { title: 'Preferences', tier: 'narrow', under: 'settings' } },
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return (
    <>
      <PageHeader
        title="Preferences"
        description="Customize how the app looks and behaves."
        breadcrumbs={trailCrumbs('settings', {}, 'Preferences')}
      />
      <PreferencesSettingsPage
        productUpdates={<ProductUpdatePreferences getClient={getProductUpdatesClient} />}
      />
    </>
  )
}
