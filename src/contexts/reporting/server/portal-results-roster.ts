// Reporting server — the roster for an Organization-wide Portals overview read.
//
// Portal owns which Portals exist and where they sit; Reporting reads their
// numbers through each Property's own time zone. These two pure steps keep the
// server function a thin shell: which Properties the caller may read, and the
// roster and zones the use case needs, one of each per Property.

import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type {
  PortalResultsPropertyZone,
  PortalResultsRosterEntry,
} from '../application/public-api'

type RosterRow = Readonly<{
  portalId: string
  propertyId: string
  group: Readonly<{ id: string }> | null
}>

export type OrganizationRoster = Readonly<{
  portals: PortalResultsRosterEntry[]
  properties: PortalResultsPropertyZone[]
}>

/**
 * A Portal is read only through its Property's own zone. A Property with no zone
 * on record cannot be read honestly, so its Portals are left out of the results
 * (the list still shows them, with no figure) rather than read in a guessed zone
 * or failing the whole Organization for one Property.
 */
export function organizationRoster(
  rows: readonly RosterRow[],
  timezones: ReadonlyMap<string, string | null>,
): OrganizationRoster {
  const readable = rows.filter((row) => timezones.get(row.propertyId))
  const portals = readable.map((row): PortalResultsRosterEntry => ({
    portalId: portalId(row.portalId),
    propertyId: propertyId(row.propertyId),
    groupId: row.group ? portalGroupId(row.group.id) : null,
  }))
  const seen = new Set<string>()
  const properties: PortalResultsPropertyZone[] = []
  for (const { propertyId: id } of readable) {
    const timezone = timezones.get(id)
    if (!timezone || seen.has(id)) continue
    seen.add(id)
    properties.push({ propertyId: propertyId(id), timezone })
  }
  return { portals, properties }
}

/** The Properties every question allows, in the order given. */
export async function readablePropertyIds(
  propertyIds: readonly string[],
  questions: ReadonlyArray<(propertyId: string) => Promise<boolean>>,
): Promise<readonly string[]> {
  const answers = await Promise.all(
    propertyIds.map(async (id) => {
      const allowed = await Promise.all(questions.map((ask) => ask(id)))
      return allowed.every(Boolean)
    }),
  )
  return propertyIds.filter((_, index) => answers[index] === true)
}
