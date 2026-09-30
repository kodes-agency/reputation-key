// Zod and SQL renderings of the Portal link icon catalogue, for the layers that
// may use them (application DTOs, the Drizzle model, the hand-written
// migration). The pure catalogue stays in `src/shared/domain/portal-link-icon.ts`.

import { z } from 'zod/v4'
import { PORTAL_LINK_ICON_KEYS } from './domain/portal-link-icon'

export const portalLinkIconKeySchema = z.enum(PORTAL_LINK_ICON_KEYS)

/** `'link', 'external-link', ...`, ready for a SQL `IN (...)` list. */
export const PORTAL_LINK_ICON_SQL_LIST = PORTAL_LINK_ICON_KEYS.map(
  (key) => `'${key}'`,
).join(', ')
