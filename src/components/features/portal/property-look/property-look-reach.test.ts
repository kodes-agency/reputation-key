import { describe, expect, it } from 'vitest'
import type { PortalLookSources } from '#/contexts/portal/application/public-api'
import {
  describeLookHeader,
  describeOwnPhoto,
  describeOwnLooks,
  followsAnyPart,
  followsPart,
  offersLookEdit,
  offersOwnLook,
  ownChipsOf,
  ownPartsOf,
  sourcesOf,
} from './property-look-reach'

const FOLLOWS: PortalLookSources = {
  photo: 'property',
  colours: 'property',
  identity: 'property',
}
const sources = (own: Partial<PortalLookSources>): PortalLookSources => ({
  ...FOLLOWS,
  ...own,
})
const OWNS_ALL = sources({ photo: 'portal', colours: 'portal', identity: 'portal' })

const portal = (
  name: string,
  lookSources?: PortalLookSources,
  publicationState: 'draft' | 'published' | 'disabled' | 'archived' = 'published',
) => ({
  name,
  publicationState,
  ...(lookSources === undefined ? {} : { lookSources }),
})

describe('sourcesOf', () => {
  it('reads a portal the overview gave no sources for as following the whole look', () => {
    expect(sourcesOf(portal('Reception'))).toEqual(FOLLOWS)
    expect(sourcesOf(portal('Spa', OWNS_ALL))).toEqual(OWNS_ALL)
  })
})

describe('followsPart and followsAnyPart', () => {
  it('follows a part only while the Property is its source', () => {
    const spa = sources({ photo: 'portal', colours: 'portal' })

    expect(followsPart(spa, 'photo')).toBe(false)
    expect(followsPart(spa, 'colours')).toBe(false)
    expect(followsPart(spa, 'identity')).toBe(true)
    expect(followsAnyPart(spa)).toBe(true)
  })

  it('does not follow the photo of a portal that shows none', () => {
    expect(followsPart(sources({ photo: 'none' }), 'photo')).toBe(false)
  })

  it('is out of reach of the look only when every part is the portal’s', () => {
    expect(followsAnyPart(OWNS_ALL)).toBe(false)
    expect(
      followsAnyPart(sources({ photo: 'none', colours: 'portal', identity: 'portal' })),
    ).toBe(false)
    expect(followsAnyPart(FOLLOWS)).toBe(true)
  })
})

describe('ownPartsOf and ownChipsOf', () => {
  it('lists the parts the portal does not follow, in the editor’s order', () => {
    expect(ownPartsOf(FOLLOWS)).toEqual([])
    expect(ownPartsOf(sources({ identity: 'portal', photo: 'portal' }))).toEqual([
      'photo',
      'identity',
    ])
    expect(ownPartsOf(OWNS_ALL)).toEqual(['photo', 'colours', 'identity'])
  })

  it('words the chips as the board does, and says No photo for a portal that shows none', () => {
    expect(ownChipsOf(OWNS_ALL)).toEqual([
      'Own photo',
      'Own colours',
      'Own name and logo',
    ])
    expect(ownChipsOf(sources({ photo: 'none' }))).toEqual(['No photo'])
    expect(ownChipsOf(FOLLOWS)).toEqual([])
  })
})

describe('describeOwnLooks', () => {
  it('says nothing while every portal follows the look', () => {
    expect(describeOwnLooks([portal('A'), portal('B', FOLLOWS)])).toBeNull()
  })

  it('names the one portal and the parts it has of its own', () => {
    expect(
      describeOwnLooks([
        portal('Reception'),
        portal('Spa', sources({ photo: 'portal', colours: 'portal' })),
      ]),
    ).toBe('Spa has its own photo and colours')
    expect(describeOwnLooks([portal('Spa', sources({ identity: 'portal' }))])).toBe(
      'Spa has its own name and logo',
    )
  })

  it('calls a portal with all three parts of its own a look of its own', () => {
    expect(describeOwnLooks([portal('Spa', OWNS_ALL)])).toBe('Spa has its own look')
  })

  it('counts several portals and lists the kinds of part they have', () => {
    expect(
      describeOwnLooks([
        portal('Spa', sources({ photo: 'portal' })),
        portal('Bar', sources({ photo: 'portal' })),
      ]),
    ).toBe('2 portals have their own photo')
    expect(
      describeOwnLooks([
        portal('Spa', sources({ photo: 'portal', colours: 'portal' })),
        portal('Bar', sources({ identity: 'portal' })),
      ]),
    ).toBe('2 portals have their own photo, colours or name and logo')
    expect(
      describeOwnLooks([
        portal('Spa', sources({ photo: 'portal' })),
        portal('Bar', sources({ colours: 'portal' })),
      ]),
    ).toBe('2 portals have their own photo or colours')
  })
})

describe('offersOwnLook', () => {
  const two = [portal('Reception'), portal('Spa')]

  it('offers it once a second portal exists and the switch is on', () => {
    expect(offersOwnLook(two, true)).toBe(true)
  })

  it('offers nothing to a property with one portal', () => {
    expect(offersOwnLook([portal('Reception')], true)).toBe(false)
    expect(
      offersOwnLook([portal('Reception'), portal('Old', undefined, 'archived')], true),
    ).toBe(false)
  })

  it('offers nothing while the switch is off', () => {
    expect(offersOwnLook(two, false)).toBe(false)
  })

  it('still tells the truth about a portal that already has its own part', () => {
    expect(
      offersOwnLook(
        [portal('Reception'), portal('Spa', sources({ photo: 'portal' }))],
        false,
      ),
    ).toBe(true)
    expect(offersOwnLook([portal('Spa', sources({ photo: 'none' }))], false)).toBe(true)
  })
})

describe('offersLookEdit', () => {
  const admin = { canEdit: true, ownLookEnabled: true, portalCount: 2 }

  it('links an account admin to the Look section of a portal once a second portal exists', () => {
    expect(offersLookEdit(admin, portal('Spa'))).toBe(true)
  })

  it('does not link a viewer who cannot edit, nor while the switch is off', () => {
    expect(offersLookEdit({ ...admin, canEdit: false }, portal('Spa'))).toBe(false)
    expect(offersLookEdit({ ...admin, ownLookEnabled: false }, portal('Spa'))).toBe(false)
  })

  it('links a portal that has its own part even when it is the only one left, so it can be undone', () => {
    const spa = portal('Spa', sources({ colours: 'portal' }))

    expect(offersLookEdit({ ...admin, portalCount: 1 }, spa)).toBe(true)
    expect(offersLookEdit({ ...admin, portalCount: 1 }, portal('Reception'))).toBe(false)
  })
})

describe('describeLookHeader', () => {
  it('keeps the old sentence for a property with nothing to offer', () => {
    expect(describeLookHeader('Avela Resort', false)).toBe(
      'How every portal at Avela Resort looks. Portal wording and links stay per portal.',
    )
  })

  it('describes the look every portal starts with once portals can have their own', () => {
    expect(describeLookHeader('Avela Resort', true)).toBe(
      'The look every portal at Avela Resort starts with. A portal can use its own photo, colours, or name and logo.',
    )
  })
})

describe('describeOwnPhoto', () => {
  it('says nothing for a portal that follows the look’s photo', () => {
    expect(describeOwnPhoto({ name: 'Reception' })).toBeNull()
    expect(
      describeOwnPhoto({ name: 'Spa', sources: sources({ colours: 'portal' }) }),
    ).toBeNull()
  })

  it('says whose photo the preview shows when it is not the look’s', () => {
    expect(describeOwnPhoto({ name: 'Spa', sources: sources({ photo: 'portal' }) })).toBe(
      'Spa has its own photo',
    )
    expect(describeOwnPhoto({ name: 'Spa', sources: sources({ photo: 'none' }) })).toBe(
      'Spa shows no photo',
    )
  })
})
