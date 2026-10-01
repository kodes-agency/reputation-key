// SQL renderings of the Portal media vocabulary, for the layers that may use
// them (the Drizzle model and the hand-written migration). The pure vocabulary
// stays in `src/shared/domain/portal-media.ts`.

import {
  PORTAL_MEDIA_PURPOSES,
  PORTAL_MEDIA_SOURCE_FORMATS,
  PORTAL_MEDIA_STATUSES,
} from './domain/portal-media'

const sqlList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ')

/** `'hero', 'logo', 'link_image'`, ready for a SQL `IN (...)` list. */
export const PORTAL_MEDIA_PURPOSE_SQL_LIST = sqlList(PORTAL_MEDIA_PURPOSES)
export const PORTAL_MEDIA_STATUS_SQL_LIST = sqlList(PORTAL_MEDIA_STATUSES)
export const PORTAL_MEDIA_SOURCE_FORMAT_SQL_LIST = sqlList(PORTAL_MEDIA_SOURCE_FORMATS)
