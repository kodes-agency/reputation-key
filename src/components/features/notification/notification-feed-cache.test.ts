import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { createKeys } from '#/shared/queries/query-keys'
import { patchNotificationFeedCache } from './notification-feed-cache'
import {
  makeNotification,
  notificationFeedHeadFixture,
} from './notification.stories.fixtures'

it('patches and rolls back only the signed-in person and Organization feed', () => {
  const client = new QueryClient()
  const scope = { userId: 'person-1', organizationId: 'org-1' }
  const key = createKeys(scope).notificationKeys.head('org-1', 20)
  const otherPerson = createKeys({ ...scope, userId: 'person-2' }).notificationKeys.head(
    'org-1',
    20,
  )
  const otherOrganization = createKeys({
    ...scope,
    organizationId: 'org-2',
  }).notificationKeys.head('org-2', 20)
  const head = notificationFeedHeadFixture(
    [makeNotification({ id: '10000000-0000-4000-8000-000000000001', status: 'unread' })],
    1,
  )
  for (const queryKey of [key, otherPerson, otherOrganization]) {
    client.setQueryData(queryKey, head)
  }

  const undo = patchNotificationFeedCache(client, scope, 'org-1', (row) => ({
    ...row,
    status: 'read',
    readAt: new Date(0),
  }))

  expect(client.getQueryData(key)).toMatchObject({ unreadCount: 0 })
  expect(client.getQueryData(otherPerson)).toBe(head)
  expect(client.getQueryData(otherOrganization)).toBe(head)
  expect(undo).toBeTypeOf('function')
  undo!()
  expect(client.getQueryData(key)).toEqual(head)
  client.clear()
})
