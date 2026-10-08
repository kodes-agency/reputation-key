import { describe, expect, it } from 'vitest'
import {
  describeGraceCutoff,
  describeShareAccess,
  describeUnpublishedCode,
  describeWhoToAsk,
} from './portal-share-guidance'

describe('describeShareAccess', () => {
  it('lets someone manage the code only with the permission and the capability, as the server asks', () => {
    expect(describeShareAccess({ canUpdate: true, writeEnabled: true })).toEqual({
      canManage: true,
      viewOnlyReason: null,
    })
  })

  it('names the role when the permission is missing', () => {
    expect(describeShareAccess({ canUpdate: false, writeEnabled: true })).toEqual({
      canManage: false,
      viewOnlyReason:
        'You do not have permission to make, replace or stop the portal’s code.',
    })
  })

  it('says portal changes are switched off when the capability is the reason', () => {
    const access = describeShareAccess({ canUpdate: true, writeEnabled: false })

    expect(access.canManage).toBe(false)
    expect(access.viewOnlyReason).toBe(
      'Changes to portals are switched off right now, so the code can’t be made, replaced or stopped.',
    )
  })
})

describe('describeWhoToAsk', () => {
  it('names the portal’s managers for someone who can only look', () => {
    expect(describeWhoToAsk(false, ['Georgi Ivanov', 'Eli Petrova'])).toBe(
      'Ask Georgi Ivanov or Eli Petrova for the QR code or print kit.',
    )
  })

  it('falls back to "a manager" when nobody can be named', () => {
    expect(describeWhoToAsk(false, [])).toBe(
      'Ask a manager of this portal for the QR code or print kit.',
    )
  })

  it('sends nobody to ask while portal changes are switched off for everyone', () => {
    expect(describeWhoToAsk(true, ['Georgi Ivanov'])).toBeNull()
  })
})

describe('describeUnpublishedCode', () => {
  it('says nothing for a live portal', () => {
    expect(describeUnpublishedCode('published')).toBeNull()
  })

  it('tells a draft what a scan shows until it is published, and offers to publish', () => {
    expect(describeUnpublishedCode('draft')).toEqual({
      title: 'Not published yet',
      body: 'Guests who scan this code see “This page isn’t available right now” until you publish the portal. You can still make and print it ahead of the launch.',
      offersReview: true,
    })
  })

  it('offers to publish a portal that was turned off again', () => {
    expect(describeUnpublishedCode('disabled')).toMatchObject({
      title: 'The portal is turned off',
      offersReview: true,
    })
  })

  it('sends an archived portal to the Portals list, where it is restored', () => {
    expect(describeUnpublishedCode('archived')).toMatchObject({
      title: 'The portal is archived',
      offersReview: false,
    })
  })
})

describe('describeGraceCutoff', () => {
  const now = new Date('2026-10-08T15:23:00Z')

  it('gives the moment in the property’s time, with how long is left', () => {
    expect(describeGraceCutoff('2026-11-07T15:23:00Z', now, 'Europe/Sofia')).toBe(
      'Nov 7, 2026, 5:23 PM Sofia time, in 30 days',
    )
  })

  it('names the city of a zone with an underscore as people write it', () => {
    expect(describeGraceCutoff('2026-11-07T15:23:00Z', now, 'America/New_York')).toBe(
      'Nov 7, 2026, 10:23 AM New York time, in 30 days',
    )
  })

  it('says UTC when the property’s zone is not known', () => {
    expect(describeGraceCutoff('2026-11-07T15:23:00Z', now)).toBe(
      'Nov 7, 2026, 3:23 PM UTC, in 30 days',
    )
  })

  it('says "within a day" on the last day and drops the countdown once past', () => {
    expect(describeGraceCutoff('2026-10-09T09:00:00Z', now, 'UTC')).toBe(
      'Oct 9, 2026, 9:00 AM UTC, within a day',
    )
    expect(describeGraceCutoff('2026-10-08T09:00:00Z', now, 'UTC')).toBe(
      'Oct 8, 2026, 9:00 AM UTC',
    )
  })

  it('is null without a cutoff or with one that is not a time', () => {
    expect(describeGraceCutoff(null, now, 'Europe/Sofia')).toBeNull()
    expect(describeGraceCutoff('soon', now, 'Europe/Sofia')).toBeNull()
  })
})
