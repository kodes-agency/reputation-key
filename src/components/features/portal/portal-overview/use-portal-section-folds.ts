import { useState } from 'react'
import type { PortalOverviewSection } from './portal-overview-view'
import { sectionExpanded } from './portal-staff-sections'
/** The page uses the same fold state for both pagination and the table. */
export function usePortalSectionFolds() {
  const [folded, setFolded] = useState<Readonly<Record<string, boolean>>>({})
  const toggleGroup = (key: string, section: PortalOverviewSection) =>
    setFolded((current) => ({
      ...current,
      [key]: sectionExpanded(section, current[key]),
    }))
  return {
    folded,
    toggleGroup,
    toggleSection: (section: PortalOverviewSection) => toggleGroup(section.key, section),
  }
}
