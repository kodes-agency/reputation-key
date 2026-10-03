import { useRouterState } from '@tanstack/react-router'
import { SectionNav } from '#/components/ui/section-nav'
import type { SectionNavItem } from '#/components/ui/section-nav-types'
import {
  activePropertySettingsSection,
  type PropertySettingsSection,
  type PropertySettingsSectionKey,
} from './property-settings-sections'

const SECTION_PATH = {
  profile: '/properties/$propertyId/settings/profile',
  google: '/properties/$propertyId/settings/google',
  replies: '/properties/$propertyId/settings/replies',
  ai: '/properties/$propertyId/settings/ai',
  people: '/properties/$propertyId/settings/people',
  targets: '/properties/$propertyId/settings/targets',
  danger: '/properties/$propertyId/settings/danger',
} as const satisfies Record<PropertySettingsSectionKey, string>

/**
 * The hub's sections as nav items: the description is the line under the label.
 * The Danger zone is a group of its own, so the list sets it apart whichever
 * section is open (it used to lose its offset, and jump, while it was the open one).
 */
export function propertySettingsNavItems(
  propertyId: string,
  sections: ReadonlyArray<PropertySettingsSection>,
): ReadonlyArray<SectionNavItem> {
  return sections.map((section) => ({
    key: section.key,
    to: SECTION_PATH[section.key],
    params: { propertyId },
    label: section.label,
    summary: section.description,
    ...(section.key === 'danger' ? { group: 'danger' } : {}),
  }))
}

/**
 * The hub's section list: a column beside the content when the space they share is
 * wide enough, a single scrolling row above it when it is not, so every section
 * stays one tap away without a menu. The row keeps the open section in view, which
 * matters for a link that lands on the last one. Sits in a `SectionNavLayout`.
 */
export function PropertySettingsNav({
  propertyId,
  sections,
}: Readonly<{
  propertyId: string
  sections: ReadonlyArray<PropertySettingsSection>
}>) {
  const active = useRouterState({
    select: (state) => activePropertySettingsSection(state.location.pathname),
  })

  return (
    <SectionNav
      aria-label="Property settings sections"
      items={propertySettingsNavItems(propertyId, sections)}
      current={active}
      groupHeadings={false}
    />
  )
}
