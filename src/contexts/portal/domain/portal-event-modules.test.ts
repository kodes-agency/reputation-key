// F3: link and group events live in flat sibling modules of events.ts, and
// events.ts re-exports them unchanged so no importer has to move.
import { describe, expect, it } from 'vitest'
import * as events from './events'
import * as groupEvents from './portal-group-events'
import * as linkEvents from './portal-link-events'

const GROUP_CONSTRUCTORS = [
  'portalGroupCreated',
  'portalGroupUpdated',
  'portalGroupDeleted',
  'portalAddedToGroup',
  'portalRemovedFromGroup',
] as const

const LINK_CONSTRUCTORS = [
  'portalLinkCategoryCreated',
  'portalLinkCategoryReordered',
  'portalLinkCategoryUpdated',
  'portalLinkCategoryDeleted',
  'portalLinkCreated',
  'portalLinkReordered',
  'portalLinkUpdated',
  'portalLinkDeleted',
] as const

describe('portal event modules', () => {
  it.each(GROUP_CONSTRUCTORS)(
    'portal-group-events owns %s and events.ts re-exports it',
    (name) => {
      expect(groupEvents[name]).toBeTypeOf('function')
      expect(events[name]).toBe(groupEvents[name])
    },
  )

  it.each(LINK_CONSTRUCTORS)(
    'portal-link-events owns %s and events.ts re-exports it',
    (name) => {
      expect(linkEvents[name]).toBeTypeOf('function')
      expect(events[name]).toBe(linkEvents[name])
    },
  )

  it('exports no constructor from the group module that the link module also exports', () => {
    const shared = Object.keys(groupEvents).filter((name) => name in linkEvents)
    expect(shared).toEqual([])
  })
})
