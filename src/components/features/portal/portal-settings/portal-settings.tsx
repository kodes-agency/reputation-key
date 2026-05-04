// Portal settings — active toggle, edit form, theme, smart routing.
// Extracted from portal-detail-page to separate the settings concern.

import { EditPortalForm } from '../portal-form/edit-portal-form'
import { ThemePresetSelector } from './theme-preset-selector'
import { SmartRoutingConfig } from './smart-routing-config'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import { Label } from '#/components/ui/label'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { Action } from '#/components/hooks/use-action'

type FormLike = { handleSubmit: () => void }

type PortalData = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: { primaryColor: string }
  smartRoutingEnabled: boolean
  smartRoutingThreshold: number
  isActive: boolean
}>

type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    theme?: { primaryColor: string }
    smartRoutingEnabled?: boolean
    smartRoutingThreshold?: number
    isActive?: boolean
  }
}

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
  smartRoutingEnabled: boolean
  onSmartRoutingEnabledChange: (enabled: boolean) => void
  smartRoutingThreshold: number
  onSmartRoutingThresholdChange: (threshold: number) => void
  isActive: boolean
  onIsActiveChange: (active: boolean) => void
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: { data: { portalId: string; key: string } }) => Promise<{
    heroImageUrl: string
  }>
  formRef: React.RefObject<FormLike | null>
}>

export function PortalSettings({
  portal,
  mutation,
  primaryColor,
  onPrimaryColorChange,
  smartRoutingEnabled,
  onSmartRoutingEnabledChange,
  smartRoutingThreshold,
  onSmartRoutingThresholdChange,
  isActive,
  onIsActiveChange,
  requestUploadUrl,
  finalizeUpload,
  formRef,
}: Props) {
  const { can } = usePermissions()

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>

      {/* Active/Inactive toggle */}
      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="portal-active" className="text-sm font-medium">
            Portal active
          </Label>
          <p className="text-xs text-muted-foreground">
            {isActive
              ? 'Guests can access this portal.'
              : 'Guests will see an "unavailable" message.'}
          </p>
        </div>
        <Switch
          id="portal-active"
          checked={isActive}
          onCheckedChange={(checked) => {
            onIsActiveChange(checked)
            mutation({ data: { portalId: portal.id, isActive: checked } })
          }}
          disabled={!can('portal.update') || mutation.isPending}
        />
      </div>

      <EditPortalForm
        portal={portal}
        mutation={mutation}
        formRef={formRef}
        requestUploadUrl={requestUploadUrl}
        finalizeUpload={finalizeUpload}
      />

      {/* Theme Presets */}
      <div className="space-y-2">
        <h3 className="font-semibold">Theme</h3>
        <ThemePresetSelector
          primaryColor={primaryColor}
          onPrimaryColorChange={onPrimaryColorChange}
          disabled={!can('portal.update')}
        />
      </div>

      {/* Smart Routing */}
      <div className="space-y-2">
        <h3 className="font-semibold">Smart Routing</h3>
        <SmartRoutingConfig
          enabled={smartRoutingEnabled}
          onEnabledChange={onSmartRoutingEnabledChange}
          threshold={smartRoutingThreshold}
          onThresholdChange={onSmartRoutingThresholdChange}
          disabled={!can('portal.update')}
        />
      </div>

      {can('portal.update') && (
        <Button onClick={() => formRef.current?.handleSubmit()}>
          {mutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      )}
    </section>
  )
}
