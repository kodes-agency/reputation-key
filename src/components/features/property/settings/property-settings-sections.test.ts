import { describe, expect, it } from 'vitest'
import type { Permission } from '#/shared/domain/permissions'
import {
  PROPERTY_SETTINGS_SECTIONS,
  activePropertySettingsSection,
  visiblePropertySettingsSections,
} from './property-settings-sections'

const granting =
  (...permissions: Permission[]) =>
  (permission: Permission) =>
    permissions.includes(permission)

describe('property settings sections', () => {
  it('lists every section once, in setup order', () => {
    expect(PROPERTY_SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'profile',
      'google',
      'replies',
      'ai',
      'people',
      'targets',
      'danger',
    ])
  })

  it('shows a reader only what reading allows', () => {
    expect(
      visiblePropertySettingsSections(granting('property.read')).map((s) => s.key),
    ).toEqual(['profile', 'google', 'people', 'danger'])
  })

  it('shows AI and targets only with their own permissions', () => {
    const keys = visiblePropertySettingsSections(
      granting('property.read', 'reply.manage', 'ai.manage', 'organization.update'),
    ).map((section) => section.key)

    expect(keys).toEqual([
      'profile',
      'google',
      'replies',
      'ai',
      'people',
      'targets',
      'danger',
    ])
  })

  it('reads the active section from the pathname', () => {
    expect(activePropertySettingsSection('/properties/p-1/settings/replies')).toBe(
      'replies',
    )
    expect(activePropertySettingsSection('/properties/p-1/settings/ai?x=1')).toBe('ai')
    expect(activePropertySettingsSection('/properties/p-1/settings')).toBeNull()
    expect(activePropertySettingsSection('/properties/p-1/settings/unknown')).toBeNull()
  })
})
