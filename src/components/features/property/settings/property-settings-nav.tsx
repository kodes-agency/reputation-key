import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '#/lib/utils'
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
 * The hub's section list. A column beside the content from `md`; a single
 * scrollable row above it on a phone, so every section stays one tap away
 * without a menu.
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
    <nav aria-label="Property settings sections" className="min-w-0">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {sections.map((section) => {
          const current = active === section.key
          return (
            <li key={section.key} className="shrink-0">
              <Link
                to={SECTION_PATH[section.key]}
                params={{ propertyId }}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'group flex min-h-9 flex-col justify-center rounded-md px-3 py-2 text-sm outline-none transition-colors',
                  'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                  current
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  section.key === 'danger' && !current && 'md:mt-4',
                )}
              >
                <span className="whitespace-nowrap">{section.label}</span>
                <span className="hidden text-xs font-normal text-muted-foreground md:block">
                  {section.description}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
