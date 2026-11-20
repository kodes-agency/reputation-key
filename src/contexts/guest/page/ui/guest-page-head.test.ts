// The head of the guest page, read back as data.

import { describe, expect, it } from 'vitest'
import { guestPageHead } from './guest-page-head'
import { guestDocumentTitle, titleRepeatsName } from './public-portal/guest-title'

const PORTAL = {
  name: 'Pool & Terrace',
  organizationName: 'Avela Resort',
  description: 'Rate your visit',
  heroImageUrl: null,
} as const

const titleOf = (head: ReturnType<typeof guestPageHead>) =>
  head.meta.find((entry): entry is { title: string } => 'title' in entry)?.title

describe('guestDocumentTitle', () => {
  it('joins the portal title and the property name once', () => {
    expect(guestDocumentTitle('Pool & Terrace', 'Avela Resort')).toBe(
      'Pool & Terrace — Avela Resort',
    )
  })

  it('is the name alone when the portal is titled with it, however it is cased or spaced', () => {
    expect(guestDocumentTitle('E2E Guest Portal P1', 'E2E Guest Portal P1')).toBe(
      'E2E Guest Portal P1',
    )
    expect(guestDocumentTitle('  avela resort ', 'Avela Resort')).toBe('avela resort')
  })

  it('is the name alone when the portal has no title', () => {
    expect(guestDocumentTitle('', 'Avela Resort')).toBe('Avela Resort')
    expect(guestDocumentTitle('   ', 'Avela Resort')).toBe('Avela Resort')
  })

  it('is the title alone when the property has no name', () => {
    expect(guestDocumentTitle('Pool & Terrace', '')).toBe('Pool & Terrace')
  })

  it('applies the rule the title block uses on the page', () => {
    expect(titleRepeatsName(' Avela Resort ', 'avela resort')).toBe(true)
    expect(titleRepeatsName('Pool & Terrace', 'Avela Resort')).toBe(false)
  })
})

describe('guestPageHead', () => {
  it('titles the tab without printing the name twice', () => {
    expect(titleOf(guestPageHead({ ...PORTAL, name: 'Avela Resort' }))).toBe(
      'Avela Resort',
    )
    expect(titleOf(guestPageHead(PORTAL))).toBe('Pool & Terrace — Avela Resort')
  })

  it('keeps the link preview title the portal title alone', () => {
    const head = guestPageHead(PORTAL)
    expect(head.meta).toContainEqual({ property: 'og:title', content: 'Pool & Terrace' })
  })

  it('is never indexable, and says nothing about why a page is unavailable', () => {
    const robots = { name: 'robots', content: 'noindex, nofollow' }
    expect(guestPageHead(PORTAL).meta).toContainEqual(robots)
    expect(guestPageHead(null)).toEqual({
      meta: [{ title: 'Page unavailable' }, robots],
    })
  })

  it('previews with the hero photo when there is one, and a plain card when not', () => {
    const withPhoto = guestPageHead({ ...PORTAL, heroImageUrl: 'https://x.test/h.jpg' })
    expect(withPhoto.meta).toContainEqual({
      property: 'og:image',
      content: 'https://x.test/h.jpg',
    })
    expect(withPhoto.meta).toContainEqual({
      name: 'twitter:card',
      content: 'summary_large_image',
    })
    expect(guestPageHead(PORTAL).meta).toContainEqual({
      name: 'twitter:card',
      content: 'summary',
    })
  })

  it('never carries the token or a canonical link', () => {
    expect(JSON.stringify(guestPageHead(PORTAL))).not.toMatch(/canonical|token/iu)
  })
})
