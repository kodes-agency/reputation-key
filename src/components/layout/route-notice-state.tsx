import { useMatches, useParams } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PageState } from './page-state'
import { refusalFrame } from './refusal-frame'
import { isRouteNotice, noticeProps } from './route-notice-copy'
import { NotFoundState, usePageWhere } from './route-page-state'

/**
 * What the app shell's not-found boundary draws: the notice a route threw, else the
 * page that does not exist. Only the shell's boundary reads notices, keeping the
 * copy out of first paint. A refusal is drawn in the frame (width tier and trail)
 * of the page it replaces; a missing Property has none to borrow.
 */
export function NoticeState({ data }: Readonly<{ data?: unknown }>) {
  const matches = useMatches()
  const where = usePageWhere()
  const { portalId } = useParams({ strict: false }) as { portalId?: string }
  const { can } = usePermissions()
  if (!isRouteNotice(data)) return <NotFoundState />
  const notice = noticeProps(data, {
    canOpenProperties: can('property.admin'),
    propertyId: where.propertyId,
    portalId,
  })
  const frame =
    data.cause === 'property' ? {} : refusalFrame(matches, notice.title, where)
  return <PageState {...notice} {...frame} />
}
