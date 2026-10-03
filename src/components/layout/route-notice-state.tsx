import { useMatches, useParams } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PageState } from './page-state'
import { refusalFrame } from './refusal-frame'
import { isRouteNotice, noticeProps } from './route-notice-copy'
import { NotFoundState, usePageWhere } from './route-page-state'

/**
 * What the app shell's not-found boundary draws: the notice a route threw (a role
 * or feature that cannot open the page, a Property that is not there), else the
 * page that does not exist. Only the shell's boundary reads notices, so the copy
 * stays out of first paint.
 *
 * A refusal of a page is drawn in the frame of the page it replaces (its width
 * tier and its trail), so a refused Properties list stays 1200 wide and a refused
 * settings page stays narrow. A missing Property has no page to borrow from.
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
