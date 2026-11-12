// Identity context — every Organization, for the platform operator console
// (ADR 0065). Newest first, capped; each says whether it still needs an
// AccountAdmin.

import type { Clock } from '#/shared/domain/clock'
import type { PlatformOrganizationView } from '../application/dto/platform-console.dto'
import type { PlatformOrganizationStore } from './platform-organization-store.port.server'
import {
  PLATFORM_ORGANIZATION_LIST_LIMIT,
  toPlatformOrganizationView,
} from './platform-administration.server'

export type ListPlatformOrganizationsDeps = Readonly<{
  store: Pick<PlatformOrganizationStore, 'listOrganizations'>
  clock: Clock
}>

export type ListPlatformOrganizations = () => Promise<
  ReadonlyArray<PlatformOrganizationView>
>

export const listPlatformOrganizations =
  (deps: ListPlatformOrganizationsDeps): ListPlatformOrganizations =>
  async () => {
    const now = deps.clock()
    const rows = await deps.store.listOrganizations({
      limit: PLATFORM_ORGANIZATION_LIST_LIMIT,
      now,
    })
    return rows.map((row) => toPlatformOrganizationView(row, now))
  }
