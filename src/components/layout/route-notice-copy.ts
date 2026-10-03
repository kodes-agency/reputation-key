// What a refusal says. The notice a route throws (`shared/auth/route-notice`)
// carries only its cause; the sentences, and where the way back leads, are
// decided here, when the shell's boundary draws it. Pure, so the copy is
// unit-tested without a router.
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'
import type { RouteBack, RouteBackTarget, RouteNotice } from '#/shared/auth/route-notice'
import type { PageStateProps } from './page-state'

export type NoticeProps = Extract<PageStateProps, { kind: 'notFound' | 'unavailable' }>

const CAUSES: readonly string[] = ['role', 'feature', 'property']

/**
 * Whether a not-found's `data` is a notice. It crosses server rendering and
 * could be anything a route threw, so it is checked, not assumed.
 */
export function isRouteNotice(data: unknown): data is RouteNotice {
  if (typeof data !== 'object' || data === null) return false
  const { cause } = data as { cause?: unknown }
  return typeof cause === 'string' && CAUSES.includes(cause)
}

const PROPERTIES: RouteBack = { to: '/properties', label: 'Back to Properties' }
const PROFILE: RouteBack = { to: '/settings/profile', label: 'Back to Profile' }

function backTo(target: RouteBackTarget): RouteBack {
  if (target === 'properties') return PROPERTIES
  return target === 'profile' ? PROFILE : target
}

/** The page, heading, reason and way back for a notice. */
export function noticeProps(notice: RouteNotice): NoticeProps {
  switch (notice.cause) {
    case 'property':
      return {
        kind: 'notFound',
        title: 'Property',
        heading: 'Property not found',
        reason: 'It may have been removed, or it may belong to a different organization.',
        back: PROPERTIES,
      }
    case 'role':
      return {
        kind: 'unavailable',
        title: notice.title,
        heading: `You do not have access to ${notice.subject ?? notice.title}`,
        reason: 'Ask an account admin if you need it.',
        back: backTo(notice.back),
      }
    case 'feature': {
      const copy = REFUSAL_COPY[notice.category]
      // An admin-enablement refusal can be lifted from the Property's settings;
      // no other can.
      const settings =
        copy.next === 'property_settings' && notice.propertyId
          ? {
              to: `/properties/${notice.propertyId}/settings`,
              label: 'Open property settings',
            }
          : PROPERTIES
      return {
        kind: 'unavailable',
        title: notice.title,
        heading: copy.title(notice.title),
        reason: copy.description,
        back: settings,
      }
    }
  }
}
