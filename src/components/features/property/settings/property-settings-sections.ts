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
