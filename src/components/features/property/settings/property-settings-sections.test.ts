import { describe, expect, it } from 'vitest'
import type { Permission } from '#/shared/domain/permissions'
import {
  PROPERTY_SETTINGS_SECTIONS,
  activePropertySettingsSection,
  propertySettingsHeader,
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

// The header names the section (UI consistency scan: FORM-04, FORM-10): one generic
// "Property settings" header over seven sections left the page untitled, with the nav
// highlight the only thing that said where you were. The account settings pages each
// title themselves; the hub does the same, from the section that is open.
describe('propertySettingsHeader', () => {
  const where = { propertyId: 'p-1', propertyName: 'Harborline Suites' }

  it('is titled with the section that is open, the way an account settings page is', () => {
    const header = propertySettingsHeader({ ...where, active: 'google' })

    expect(header.title).toBe('Google')
  })

  it('ends the breadcrumb on the section, under Settings, which links back to the hub', () => {
    expect(propertySettingsHeader({ ...where, active: 'google' }).breadcrumbs).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Harborline Suites', to: '/properties/p-1' },
      { label: 'Settings', to: '/properties/p-1/settings' },
      { label: 'Google' },
    ])
  })

  it('gives every section a title of its own, so no two pages read the same', () => {
    const titles = PROPERTY_SETTINGS_SECTIONS.map(
      (section) => propertySettingsHeader({ ...where, active: section.key }).title,
    )

    expect(new Set(titles).size).toBe(PROPERTY_SETTINGS_SECTIONS.length)
  })

  it('is the hub itself while no section is open (the hub redirects, so briefly)', () => {
    const header = propertySettingsHeader({ ...where, active: null })

    expect(header.title).toBe('Property settings')
    expect(header.breadcrumbs.at(-1)).toEqual({ label: 'Settings' })
    expect(header.breadcrumbs).toHaveLength(3)
  })
})
