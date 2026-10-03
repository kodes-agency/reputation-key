import { PageState } from './page-state'
import { isRouteNotice, noticeProps } from './route-notice-copy'
import { NotFoundState } from './route-page-state'

/**
 * What the app shell's not-found boundary draws: the notice a route threw (a role
 * or feature that cannot open the page, a Property that is not there), else the
 * page that does not exist. Only the shell's boundary reads notices, so the copy
 * stays out of first paint.
 */
export function NoticeState({ data }: Readonly<{ data?: unknown }>) {
  return isRouteNotice(data) ? <PageState {...noticeProps(data)} /> : <NotFoundState />
}
