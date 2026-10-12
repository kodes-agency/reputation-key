// What a refusal says. The notice a route throws (`shared/auth/route-notice`)
// carries only its cause; the sentences, and where the way back leads, are
// decided here, when the shell's boundary draws it. Pure, so the copy is
// unit-tested without a router.
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'
import type { RouteBack, RouteBackTarget, RouteNotice } from '#/shared/auth/route-notice'
import type { PageStateProps } from './page-state'

export type NoticeProps = Extract<PageStateProps, { kind: 'notFound' | 'unavailable' }> &
  Readonly<{ title: string }>

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

const PROPERTIES: RouteBack = { to: '/properties', label: 'Back to properties' }
const PROFILE: RouteBack = { to: '/settings/profile', label: 'Back to profile' }

/** What the reader can reach, and where they are, which decide where "back" can lead. */
export type NoticeAccess = Readonly<{
  /** The reader may open the Properties list (`property.admin`). */
  canOpenProperties: boolean
  /** The Property and the Portal in the address, for a refusal whose way back is one of them. */
  propertyId?: string
  portalId?: string
}>

const OPEN_ACCESS: NoticeAccess = { canOpenProperties: true }

/**
 * The Properties list is the way back from most refusals, but a role that cannot
 * open it would follow the link into a second refusal, so it goes to its profile.
 */
function propertiesOrProfile({ canOpenProperties }: NoticeAccess): RouteBack {
  return canOpenProperties ? PROPERTIES : PROFILE
}

/** A place inside the Property the address names; the Properties list when the address names none. */
function withinProperty(
  access: NoticeAccess,
  place: (propertyId: string, portalId: string | undefined) => RouteBack,
): RouteBack {
  const { propertyId, portalId } = access
  return propertyId ? place(propertyId, portalId) : propertiesOrProfile(access)
}

function backTo(target: RouteBackTarget, access: NoticeAccess): RouteBack {
  switch (target) {
    case 'properties':
      return propertiesOrProfile(access)
    case 'profile':
      return PROFILE
    case 'propertySettings':
      return withinProperty(access, (propertyId) => ({
        to: `/properties/${propertyId}/settings/profile`,
        label: 'Back to property settings',
      }))
    case 'portal':
      return withinProperty(access, (propertyId, portalId) =>
        portalId
          ? {
              to: `/properties/${propertyId}/portals/${portalId}`,
              label: 'Back to portal',
            }
          : { to: `/properties/${propertyId}/portals`, label: 'Back to portals' },
      )
    default:
      return target
  }
}

/** The page, heading, reason and way back for a notice. */
export function noticeProps(
  notice: RouteNotice,
  access: NoticeAccess = OPEN_ACCESS,
): NoticeProps {
  switch (notice.cause) {
    case 'property':
      return {
        kind: 'notFound',
        title: 'Property',
        heading: 'Property not found',
        reason: 'It may have been removed, or it may belong to a different organization.',
        back: propertiesOrProfile(access),
      }
    case 'role':
      return {
        kind: 'unavailable',
        title: notice.title,
        heading: `You do not have access to ${notice.subject ?? notice.title}`,
        reason: 'Ask an account admin if you need it.',
        back: backTo(notice.back, access),
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
          : propertiesOrProfile(access)
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
