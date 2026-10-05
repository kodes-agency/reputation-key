import type { Crumb } from '#/components/layout/page-header'
import type { Permission } from '#/shared/domain/permissions'

export type PropertySettingsSectionKey =
  'profile' | 'google' | 'replies' | 'ai' | 'people' | 'targets' | 'danger'

export type PropertySettingsSection = Readonly<{
  key: PropertySettingsSectionKey
  label: string
  description: string
  /** Any one of these permissions shows the section. */
  anyOf: ReadonlyArray<Permission>
}>

/**
 * One place for everything configured on a property, in the order a manager
 * sets a property up. Each section is its own route so a link can land on it
 * and its loader fetches only what it shows.
 */
export const PROPERTY_SETTINGS_SECTIONS: ReadonlyArray<PropertySettingsSection> =
  Object.freeze([
    {
      key: 'profile',
      label: 'Profile',
      description: 'Name, country, timezone and public display name',
      anyOf: ['property.read'],
    },
    {
      key: 'google',
      label: 'Google',
      description: 'Business Profile link and review source',
      anyOf: ['property.read'],
    },
    {
      key: 'replies',
      label: 'Replies',
      description: 'Reply language, voice and templates',
      anyOf: ['reply.manage', 'property.update'],
    },
    {
      key: 'ai',
      label: 'AI',
      description: 'AI features, data use and analysis progress',
      anyOf: ['ai.manage'],
    },
    {
      key: 'people',
      label: 'People',
      description: 'Responsible managers',
      anyOf: ['property.read'],
    },
    {
      key: 'targets',
      label: 'Targets',
      description: 'Response and handling targets',
      anyOf: ['organization.update'],
    },
    {
      key: 'danger',
      label: 'Danger zone',
      description: 'Disconnect, archive, remove or restore',
      anyOf: ['property.read'],
    },
  ])

export function visiblePropertySettingsSections(
  can: (permission: Permission) => boolean,
): ReadonlyArray<PropertySettingsSection> {
  return PROPERTY_SETTINGS_SECTIONS.filter((section) => section.anyOf.some(can))
}

/** The section a settings pathname is on, or null outside the hub. */
export function activePropertySettingsSection(
  pathname: string,
): PropertySettingsSectionKey | null {
  const match = /\/properties\/[^/]+\/settings\/([a-z-]+)/.exec(pathname)
  const key = match?.[1]
  return PROPERTY_SETTINGS_SECTIONS.some((section) => section.key === key)
    ? (key as PropertySettingsSectionKey)
    : null
}

/**
 * The hub's page header, named for the section that is open: its title is the section
 * and the breadcrumb ends on it, under Settings, which links back to the hub. A page
 * that sits in a nav names itself, so a slow or failed navigation never leaves it
 * untitled and a screen reader hears where it is.
 */
export function propertySettingsHeader({
  propertyId,
  propertyName,
  active,
}: Readonly<{
  propertyId: string
  propertyName: string
  active: PropertySettingsSectionKey | null
}>): Readonly<{ title: string; breadcrumbs: readonly Crumb[] }> {
  const section = PROPERTY_SETTINGS_SECTIONS.find((candidate) => candidate.key === active)
  const parents: readonly Crumb[] = [
    { label: 'Properties', to: '/properties' },
    { label: propertyName, to: `/properties/${propertyId}` },
  ]
  if (!section) {
    return {
      title: 'Property settings',
      breadcrumbs: [...parents, { label: 'Settings' }],
    }
  }
  return {
    title: section.label,
    breadcrumbs: [
      ...parents,
      { label: 'Settings', to: `/properties/${propertyId}/settings` },
      { label: section.label },
    ],
  }
}
