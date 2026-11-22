import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PropertyId } from '#/shared/domain/ids'

/** A staff answer that lists the given Properties as accessible (`null` means all). */
export const staffApiOf = (
  accessible: ReadonlyArray<PropertyId> | null,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})
