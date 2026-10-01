import { Badge } from '#/components/ui/badge'
import { PortalExperienceActionError } from './portal-experience-action-error'
import { PortalLocalizedOverrideForm } from './portal-localized-override-form'
import { PortalPropertyContentForm } from './portal-property-content-form'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { portalPropertyContentDraftKey } from '../portal-editor/portal-draft-keys'
import {
  PORTAL_GUEST_LOCALE_LABEL,
  type PortalExperienceActions,
  type PortalExperienceSettings,
} from './portal-experience-settings-types'

export function PortalLocalizedContentEditor({
  locale,
  propertyId,
  portalId,
  experience,
  actions,
  disabled,
}: Readonly<{
  locale: OfferedGuestLocale
  propertyId: string
  portalId: string
  experience: PortalExperienceSettings
  actions: PortalExperienceActions
  disabled: boolean
}>) {
  const baseline = experience.content.find((item) => item.locale === locale)
  const override = experience.overrides.find((item) => item.locale === locale)
  const baselineReadOnly = disabled || !experience.canManagePropertyBrand

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{PORTAL_GUEST_LOCALE_LABEL[locale]} guest content</h3>
        <Badge variant="secondary">{locale.toUpperCase()}</Badge>
      </div>
      {!experience.canManagePropertyBrand ? (
        <p className="text-sm text-muted-foreground">Managed by an Account Admin</p>
      ) : null}
      {/* Keyed on the property fallback only: it keeps an explicit Save, so it
          remounts on the saved values. The override below autosaves as it is
          typed and must NOT remount when a save lands. */}
      <PortalPropertyContentForm
        key={portalPropertyContentDraftKey(experience, locale)}
        locale={locale}
        propertyId={propertyId}
        initialTitle={baseline?.title ?? ''}
        initialDescription={baseline?.shortDescription ?? ''}
        action={actions.saveContent}
        readOnly={baselineReadOnly}
      />
      <PortalLocalizedOverrideForm
        locale={locale}
        portalId={portalId}
        initialTitle={override?.title ?? ''}
        initialDescription={override?.shortDescription ?? ''}
        titlePlaceholder={baseline?.title || 'Uses Property fallback'}
        descriptionPlaceholder={baseline?.shortDescription || 'Uses Property fallback'}
        action={actions.saveOverride}
        disabled={disabled}
      />
      <PortalExperienceActionError action={actions.saveContent} />
      <PortalExperienceActionError action={actions.saveOverride} />
    </div>
  )
}
