// Property profile update and its fact commit in one transaction.

import type { OrganizationId } from '#/shared/domain/ids'
import type { Property, PropertyId } from '../../domain/types'
import type { PropertyUpdated } from '../../domain/events'

/**
 * Property update + property.updated fact in one transaction. The use case
 * holds the not_found contract via its pre-read.
 *
 * `patch` carries only the columns this request changes. The use case reads the
 * Property without a lock, and the two expected versions fence the Google
 * binding (`sourceEpoch`) and the name and timezone (`profileVersion`) only: a
 * column the patch repeats from that read would overwrite another save of it
 * that committed in between, and neither version would notice.
 *
 * `event` is built from the row as committed, so the fact and the answer name
 * the Property this save left behind, including what an overlapping save wrote.
 */
export type UpdatePropertyCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  expectedSourceEpoch: number
  expectedProfileVersion: number
  patch: Readonly<Partial<Property>>
  event: (committed: Property) => PropertyUpdated
}>

export type PropertyCommandStore = Readonly<{
  /** Answers with the Property as committed. */
  updateProperty(command: UpdatePropertyCommand): Promise<Property>
}>
