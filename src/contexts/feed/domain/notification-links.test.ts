import { describe, it, expect } from 'vitest'
import type { NotificationPayload } from './notification-payload'
import { notificationLink } from './notification-templates'
import { UUID } from './notification-templates.test-fixtures'
import { NOTIFICATION_RESOURCE_TYPES } from './notification-types'

type LinkArgs = Parameters<typeof notificationLink>
type LinkCase = readonly [
  name: string,
  args: LinkArgs,
  expected: ReturnType<typeof notificationLink>,
]

const SITE_PORTAL = '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c'
const waiting: NotificationPayload = {
  propertyName: 'Riverside Hotel',
  siteHost: 'menu.example.com',
  portalName: 'Lobby',
  portalId: SITE_PORTAL,
}
const ACCOUNT_PAGE = { path: '/settings/profile', search: {} } as const
const ITEM_LINK = { path: '/inbox', search: { itemId: UUID } } as const

const LINK_CASES: ReadonlyArray<LinkCase> = [
  [
    'uses a neutral account page for Organization-scoped notices',
    ['organization', 'org-1', null],
    ACCOUNT_PAGE,
  ],
  [
    'uses a neutral account page for Organization-scoped notices',
    ['organization', 'org-1', null, 'account.organization_access_removed'],
    ACCOUNT_PAGE,
  ],
  [
    'sends the member to Properties when their property access changed',
    ['organization', 'org-1', null, 'account.organization_property_access_changed'],
    { path: '/properties', search: {} },
  ],
  [
    'sends the inviter to Members when their invitation was accepted',
    ['organization', 'org-1', null, 'account.invitation_accepted'],
    { path: '/settings/members', search: {} },
  ],
  [
    'opens the Inbox at the Property whose history was imported',
    ['property', UUID, UUID, 'property.review_import_finished'],
    { path: '/inbox', search: { queue: 'open', propertyId: UUID } },
  ],
  [
    'deep-links an inbox item through typed search params',
    ['inbox_item', UUID, 'prop-1'],
    ITEM_LINK,
  ],
  // Regression: the previous builder used the goal's resourceId as a
  // propertyId, producing a dead /properties/<goalId> route. A goal notice's
  // resource is the monthly result it reports; the Property's Goals page
  // opens the goal that result belongs to.
  [
    'links a goal notice to the goal of the monthly result it reports',
    ['goal', 'result-9', 'prop-1'],
    { path: '/properties/prop-1/goals', search: { result: 'result-9' } },
  ],
  // A grouped assignment is many items: it opens the recipient's own queue at
  // that Property, not whichever item happened to sort first.
  [
    "opens a grouped assignment on the recipient's queue at that Property",
    ['inbox_item', UUID, 'prop-1', 'inbox.bulk_assigned'],
    { path: '/inbox', search: { queue: 'mine', propertyId: 'prop-1' } },
  ],
  [
    "opens a grouped assignment on the recipient's queue at that Property",
    ['inbox_item', UUID, 'prop-1', 'inbox.assigned'],
    ITEM_LINK,
  ],
  // A bulk reopen is many items too, reopened for whoever is responsible, not
  // assigned to the reader: it opens that Property's Open queue.
  [
    "opens a grouped reopen on that Property's open items",
    ['inbox_item', UUID, 'prop-1', 'inbox.bulk_reopened'],
    { path: '/inbox', search: { queue: 'open', propertyId: 'prop-1' } },
  ],
  [
    "opens a grouped reopen on that Property's open items",
    ['inbox_item', UUID, null, 'inbox.bulk_reopened'],
    { path: '/inbox', search: { queue: 'open' } },
  ],
  [
    "opens a grouped reopen on that Property's open items",
    ['inbox_item', UUID, 'prop-1', 'inbox.reopened'],
    ITEM_LINK,
  ],
  [
    'lands legacy reply rows on the inbox list rather than a stale reply',
    ['reply', 'reply-1', 'prop-1'],
    { path: '/inbox', search: {} },
  ],
  [
    'opens the Linktree of the Portal it names',
    ['portal_destination', 'site-1', 'prop-1', 'portal.link_approval', waiting],
    {
      path: `/properties/prop-1/portals/${SITE_PORTAL}`,
      search: { tab: 'page', section: 'linktree' },
    },
  ],
  [
    'opens the Property’s Portals when the row names none',
    ['portal_destination', 'site-1', 'prop-1', undefined, {}],
    { path: '/properties/prop-1/portals', search: {} },
  ],
  [
    'opens the Property’s Portals when the row names none',
    ['portal_destination', 'site-1', null],
    { path: '/properties', search: {} },
  ],
]

describe('notificationLink', () => {
  it.each(LINK_CASES)('%s', (_name, args, expected) => {
    expect(notificationLink(...args)).toEqual(expected)
  })

  it.each(['goal', 'portal', 'property'] as const)(
    'never builds a %s link into a Property it does not have',
    (resourceType) => {
      expect(notificationLink(resourceType, 'r', null).path).toBe('/properties')
    },
  )

  it('covers every resource type', () => {
    for (const t of NOTIFICATION_RESOURCE_TYPES) {
      expect(notificationLink(t, 'r', 'p').path).toMatch(/^\//)
    }
  })
})
