import { describe, expect, it } from 'vitest'
import {
  describeGraceCutoff,
  describeUnpublishedCode,
  describeWhoToAsk,
  NFC_ADDRESS_HINT,
  NFC_SHORT_ADDRESS_HINT,
  nfcAddressHint,
} from './portal-share-guidance'

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
    expect(describeUnpublishedCode('published', true)).toBeNull()
    expect(describeUnpublishedCode('published', false)).toBeNull()
  })

  it('tells a draft what a scan shows until it is published, and offers to publish', () => {
    expect(describeUnpublishedCode('draft', true)).toEqual({
      title: 'Not published yet',
      body: 'Guests who scan this code see “This page isn’t available right now” until you publish the portal. You can still make the code, download its QR image and copy its NFC address ahead of the launch. The print kit waits until the portal is live.',
      offersReview: true,
    })
  })

  it('tells someone who can only look the same fact, without sending them to publish', () => {
    expect(describeUnpublishedCode('draft', false)).toEqual({
      title: 'Not published yet',
      body: 'Guests who scan this code see “This page isn’t available right now” until the portal is published.',
      offersReview: false,
    })
    expect(describeUnpublishedCode('disabled', false)).toMatchObject({
      body: expect.stringMatching(/until the portal is published again/),
      offersReview: false,
    })
    expect(describeUnpublishedCode('archived', false)?.body).not.toMatch(/Restore/)
  })

  it('offers to publish a portal that was turned off again', () => {
    expect(describeUnpublishedCode('disabled', true)).toMatchObject({
      title: 'The portal is turned off',
      body: expect.stringMatching(/until you publish the portal again/),
      offersReview: true,
    })
  })

  it('asks for an archived portal to be restored before it is shared', () => {
    expect(describeUnpublishedCode('archived', true)).toMatchObject({
      title: 'The portal is archived',
      body: expect.stringMatching(/Restore it before you share it\./),
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

describe('nfcAddressHint', () => {
  const SHORT = 'https://ap.up.railway.app/p/7K3QZ0VD9MWX4HT2BN6R'
  const LONG =
    'https://web-closed-beta-v2.up.railway.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

  it('names the NTAG213 for the short print address, which fits one', () => {
    expect(nfcAddressHint(SHORT)).toBe(NFC_SHORT_ADDRESS_HINT)
    expect(NFC_SHORT_ADDRESS_HINT).toContain('NTAG213')
    expect(Buffer.byteLength(SHORT)).toBeLessThanOrEqual(144)
  })

  it('says nothing about the tag for the long address, which does not fit an NTAG213', () => {
    expect(nfcAddressHint(LONG)).toBe(NFC_ADDRESS_HINT)
    expect(NFC_ADDRESS_HINT).not.toContain('NTAG')
    expect(Buffer.byteLength(LONG)).toBeGreaterThan(144)
  })

  it('is the general hint while the address is not in memory', () => {
    expect(nfcAddressHint(null)).toBe(NFC_ADDRESS_HINT)
  })
})
