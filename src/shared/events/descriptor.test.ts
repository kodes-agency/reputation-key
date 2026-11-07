import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod/v4'
import type { DomainEvent } from './events'
import { resolveEventAggregate } from './descriptor'
import type { DefinedEventType } from './registry.server'

describe('event descriptor contracts', () => {
  it('defines a descriptor for every domain event, including events exposed by barrels', () => {
    expectTypeOf<DomainEvent['_tag']>().toEqualTypeOf<DefinedEventType>()
  })

  it.each([
    ['reviewId', 'review'],
    ['runId', 'run'],
    ['replyId', 'reply'],
    ['inboxItemId', 'inbox_item'],
    ['monthlyResultId', 'monthly_result'],
    ['noteId', 'note'],
    ['scheduleId', 'schedule'],
    ['uploadId', 'upload'],
    ['propertyId', 'property'],
    ['portalId', 'portal'],
    ['portalGroupId', 'portal_group'],
    ['portalLinkId', 'portal_link'],
    ['portalLinkCategoryId', 'portal_link_category'],
    ['teamId', 'team'],
    ['staffId', 'staff'],
    ['goalId', 'goal'],
    ['invitationId', 'invitation'],
    ['importJobId', 'import_job'],
    ['connectionId', 'connection'],
    ['scanId', 'scan'],
    ['ratingId', 'rating'],
    ['feedbackId', 'feedback'],
    ['linkId', 'link'],
    ['userId', 'user'],
    ['memberUserId', 'member_user'],
    ['closureLineageId', 'closure_lineage'],
  ])('uses the declared %s identifier and %s type', (id, type) => {
    expect(
      resolveEventAggregate(
        {
          type: 'example.changed',
          version: 1,
          schema: z.object({}),
          aggregate: { id, type },
        },
        { eventId: 'event-1', unrelatedId: 'unrelated-1', [id]: 'aggregate-1' },
        'event-1',
      ),
    ).toEqual({ id: 'aggregate-1', type })
  })

  it('uses the event sentinel when a historical fact lacks its declared identifier', () => {
    expect(
      resolveEventAggregate(
        {
          type: 'example.changed',
          version: 1,
          schema: z.object({}),
          aggregate: { id: 'importJobId', type: 'import_job' },
        },
        { propertyId: 'property-1', reviewId: 'review-1' },
        'event-1',
      ),
    ).toEqual({ id: 'event-1', type: 'event' })
  })
})
