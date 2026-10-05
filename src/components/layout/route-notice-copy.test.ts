// What a refusal says: the page that was asked for, what is wrong, why, and the
// one way out. A route throws only the cause (see `shared/auth/route-notice`);
// these are the sentences it becomes when the shell draws it.
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_REFUSAL_CATEGORIES,
  REFUSAL_COPY,
} from '#/shared/auth/capability-refusal-category'
import { PROPERTY_NOT_FOUND } from '#/shared/auth/route-notice'
import { isRouteNotice, noticeProps } from './route-notice-copy'

describe('isRouteNotice', () => {
  it.each([
    PROPERTY_NOT_FOUND,
    { cause: 'role', title: 'People', back: 'properties' },
    { cause: 'feature', title: 'Goals', category: 'not_in_beta' },
  ])('accepts %j', (value) => {
    expect(isRouteNotice(value)).toBe(true)
  })

  it.each([undefined, null, 'People', 7, {}, { cause: 'other' }, { cause: 4 }])(
    'rejects %j, which is not a notice',
    (value) => {
      expect(isRouteNotice(value)).toBe(false)
    },
  )
})

describe('a role that cannot open the page', () => {
  it('says what the role cannot reach and who can change that', () => {
    expect(noticeProps({ cause: 'role', title: 'People', back: 'properties' })).toEqual({
      kind: 'unavailable',
      title: 'People',
      heading: 'You do not have access to People',
      reason: 'Ask an account admin if you need it.',
      back: { to: '/properties', label: 'Back to properties' },
    })
  })

  it('sends a role with no Properties to its profile', () => {
    expect(
      noticeProps({ cause: 'role', title: 'Properties', back: 'profile' }).back,
    ).toEqual({ to: '/settings/profile', label: 'Back to profile' })
  })

  it('reads a subject that is not a noun as the sentence’s object', () => {
    const copy = noticeProps({
      cause: 'role',
      title: 'New Goal',
      subject: 'this page',
      back: { to: '/properties/p1/goals', label: 'Back to goals' },
    })
    expect(copy.heading).toBe('You do not have access to this page')
    expect(copy.title).toBe('New Goal')
    expect(copy.back).toEqual({ to: '/properties/p1/goals', label: 'Back to goals' })
  })
})

describe('a feature that is switched off', () => {
  it.each(CAPABILITY_REFUSAL_CATEGORIES)(
    'says the %s refusal in its own words',
    (category) => {
      const copy = noticeProps({ cause: 'feature', title: 'Goals', category })
      expect(copy).toMatchObject({
        kind: 'unavailable',
        title: 'Goals',
        heading: REFUSAL_COPY[category].title('Goals'),
        reason: REFUSAL_COPY[category].description,
      })
    },
  )

  it('sends an admin-enablement refusal to the Property’s settings, where it can be lifted', () => {
    expect(
      noticeProps({
        cause: 'feature',
        title: 'Goals',
        category: 'needs_admin_enablement',
        propertyId: 'p2',
      }).back,
    ).toEqual({ to: '/properties/p2/settings', label: 'Open property settings' })
  })

  it('offers no settings link for a refusal no setting can lift', () => {
    for (const category of CAPABILITY_REFUSAL_CATEGORIES) {
      if (REFUSAL_COPY[category].next !== null) continue
      expect(
        noticeProps({ cause: 'feature', title: 'Portals', category, propertyId: 'p2' })
          .back,
      ).toEqual({ to: '/properties', label: 'Back to properties' })
    }
  })

  it('falls back to the Properties list when there is no Property to open', () => {
    expect(
      noticeProps({
        cause: 'feature',
        title: 'Goals',
        category: 'needs_admin_enablement',
      }).back,
    ).toEqual({ to: '/properties', label: 'Back to properties' })
  })
})

describe('a way back inside the Property in the address', () => {
  const where = { canOpenProperties: true, propertyId: 'p1', portalId: 'pt1' }

  it('leads back to the Property’s settings', () => {
    expect(
      noticeProps(
        { cause: 'role', title: 'AI settings', back: 'propertySettings' },
        where,
      ).back,
    ).toEqual({
      to: '/properties/p1/settings/profile',
      label: 'Back to property settings',
    })
  })

  it('leads back to the Portal, which opens on its Page tab', () => {
    expect(
      noticeProps({ cause: 'role', title: 'Review and publish', back: 'portal' }, where)
        .back,
    ).toEqual({ to: '/properties/p1/portals/pt1', label: 'Back to portal' })
  })

  it('leads back to the Portals list when the address names no Portal', () => {
    expect(
      noticeProps(
        { cause: 'role', title: 'Review and publish', back: 'portal' },
        { canOpenProperties: true, propertyId: 'p1' },
      ).back,
    ).toEqual({ to: '/properties/p1/portals', label: 'Back to portals' })
  })

  it('falls back to the way out of the app when the address names no Property', () => {
    expect(
      noticeProps(
        { cause: 'role', title: 'AI settings', back: 'propertySettings' },
        { canOpenProperties: true },
      ).back,
    ).toEqual({ to: '/properties', label: 'Back to properties' })
  })
})

describe('a way back the reader cannot follow', () => {
  const noProperties = { canOpenProperties: false }
  const profile = { to: '/settings/profile', label: 'Back to profile' }

  it('leads a role that cannot open Properties to its profile, not into a second refusal', () => {
    expect(
      noticeProps({ cause: 'role', title: 'Inbox', back: 'properties' }, noProperties)
        .back,
    ).toEqual(profile)
    expect(noticeProps(PROPERTY_NOT_FOUND, noProperties).back).toEqual(profile)
    expect(
      noticeProps(
        { cause: 'feature', title: 'Goals', category: 'not_in_beta' },
        noProperties,
      ).back,
    ).toEqual(profile)
  })

  it('keeps a link of the notice’s own, which the reader was already allowed to open', () => {
    const own = { to: '/properties/p1/goals', label: 'Back to goals' }
    expect(
      noticeProps({ cause: 'role', title: 'Goal', back: own }, noProperties).back,
    ).toEqual(own)
  })
})

describe('a Property that is not there', () => {
  it('says "not found", which is what the e2e not-found check looks for', () => {
    const copy = noticeProps(PROPERTY_NOT_FOUND)
    expect(copy.kind).toBe('notFound')
    expect(copy.heading).toMatch(/not found/i)
    expect(copy.back).toEqual({ to: '/properties', label: 'Back to properties' })
  })
})
