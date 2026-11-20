import { describe, expect, it } from 'vitest'
import { can, type Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
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

  it('calls the responsibility section Responsible managers, not People', () => {
    const labels = Object.fromEntries(
      PROPERTY_SETTINGS_SECTIONS.map((section) => [section.key, section.label]),
    )
    expect(labels.people).toBe('Responsible managers')
  })

  it('shows a reader only what reading allows', () => {
    expect(
      visiblePropertySettingsSections(granting('property.read')).map((s) => s.key),
    ).toEqual(['profile', 'google', 'people', 'danger'])
  })

  // A PropertyManager drafts replies and reads trends, so the page that says whether
  // AI is on is theirs to read; only an AccountAdmin (`ai.manage`) can change it.
  it('shows the AI section to a role that uses AI, and not to one that does not', () => {
    const usesAi = visiblePropertySettingsSections(
      granting('property.read', 'ai.reply.generate'),
    ).map((section) => section.key)
    const doesNot = visiblePropertySettingsSections(
      granting('property.read', 'reply.manage'),
    ).map((section) => section.key)

    expect(usesAi).toContain('ai')
    expect(doesNot).not.toContain('ai')
  })

  it('follows the real roles: AI is a manager and AccountAdmin section, never a Member one', () => {
    const forRole = (role: Role) =>
      visiblePropertySettingsSections((permission) => can(role, permission)).map(
        (section) => section.key,
      )

    expect(forRole('AccountAdmin')).toContain('ai')
    expect(forRole('PropertyManager')).toContain('ai')
    expect(forRole('Member')).not.toContain('ai')
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

    expect(header.title).toBe('Google connection')
  })

  it('ends the breadcrumb on the section, under Property settings, which links back to the hub', () => {
    // The place is named as the sidebar names it, and the section as the nav beside it does.
    expect(propertySettingsHeader({ ...where, active: 'google' }).breadcrumbs).toEqual([
      { label: 'Properties', to: '/properties' },
      { label: 'Harborline Suites', to: '/properties/p-1' },
      { label: 'Property settings', to: '/properties/p-1/settings' },
      { label: 'Google connection' },
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
    expect(header.breadcrumbs.at(-1)).toEqual({ label: 'Property settings' })
    expect(header.breadcrumbs).toHaveLength(3)
  })
})
