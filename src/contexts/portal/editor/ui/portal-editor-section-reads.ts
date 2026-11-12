// Which reads each section waits on. A section whose reads are still loading or
// failed says so itself, so one failed read leaves every other section usable.

import type { PortalEditorSection } from './portal-editor-sections'
import type {
  PortalEditorRead,
  PortalEditorReadKey,
  PortalEditorResources,
} from './portal-editor-types'

const SECTION_READS: Readonly<
  Record<PortalEditorSection, ReadonlyArray<PortalEditorReadKey>>
> = {
  look: ['portalExperience'],
  welcome: ['portalExperience'],
  rating: ['publicationHistory'],
  'private-note': [],
  linktree: ['linktree', 'responsibleManagerMembers', 'approvedDestinations'],
  footer: [],
  languages: ['languageCoverage'],
  group: ['portalGroups'],
  responsible: ['responsibleManagers', 'responsibleManagerMembers'],
}

/** The reads this section still waits on; empty once it can render. */
export function pendingSectionReads(
  section: PortalEditorSection,
  resources: PortalEditorResources,
): ReadonlyArray<PortalEditorRead> {
  return SECTION_READS[section].flatMap((key) => {
    const read = resources.reads?.[key]
    return resources[key] === undefined && read !== undefined ? [read] : []
  })
}

/** Whether a resource is in hand or on its way. */
export function isResourceExpected(
  resources: PortalEditorResources,
  key: PortalEditorReadKey,
): boolean {
  return resources[key] !== undefined || resources.reads?.[key] !== undefined
}
