import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { PROPERTY_ID } from './guest-voice-fixtures-build'
import { LARGE_READ } from './guest-voice-fixtures-large'
import { PROVISIONAL_READ, URGENT_READ } from './guest-voice-fixtures-states'
import { NOT_ENOUGH_READ, SMALL_READ } from './guest-voice-fixtures-small'
import { GuestVoiceV2Body } from './guest-voice-v2-body'

/** The real router Link needs a router to build its href; none of its routes load. */
function render(element: ReactElement): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: element }),
  )
}

const noop = () => undefined

function body(
  read: GuestVoiceV2Read,
  {
    range = 'auto',
    notRight = false,
  }: { range?: GuestVoiceRange; notRight?: boolean } = {},
): string {
  return render(
    createElement(GuestVoiceV2Body, {
      propertyId: PROPERTY_ID,
      range,
      view: {
        read,
        openIssueId: null,
        onOpenIssueChange: noop,
        drawer: { status: 'pending' },
        onNotRight: notRight ? noop : undefined,
      },
    }),
  )
}

const headings = (markup: string) =>
  [...markup.matchAll(/<h2[^>]*>(.*?)<\/h2>/gu)].map((match) => match[1])

describe('the hotel page', () => {
  const markup = body(LARGE_READ)

  it('lists its sections in the order a manager reads them', () => {
    expect(headings(markup)).toEqual([
      'In short',
      'Fix first',
      'Watch',
      'Guests love',
      'What changed',
      'Every topic',
    ])
  })

  it('names the window and why it is that one before any figure', () => {
    expect(markup).toContain(
      'Last 90 days, chosen because it holds 128 reviews with text (plus 96 without text).',
    )
    expect(markup.indexOf('chosen because')).toBeLessThan(markup.indexOf('In short'))
    expect(markup).toContain('Jul 31 to Oct 29, 2026')
  })

  it('ranks four problems, the most stars at stake first, each with its figures', () => {
    const cards = markup.split('<article').slice(1)

    expect(cards.length).toBeGreaterThanOrEqual(4)
    expect(cards[0]).toContain('Facilities and equipment')
    expect(cards[0]).toContain(
      '<b class="font-medium text-foreground tabular-nums">19 of 128</b>',
    )
    expect(cards[0]).toContain('Rising, likely real')
    expect(cards[0]).toContain('worth up to about')
    expect(cards[0]).toContain('association, not proof')
    expect(cards[1]).toContain('Cleanliness')
    expect(cards[1]).toContain('Steady')
  })

  it('keeps the words of the average readable aloud as well as drawn', () => {
    expect(markup).toContain(
      'Those reviews gave 2.1 stars on average, the rest 4.3 stars',
    )
  })

  it('opens an issue from its title, and says it opens a dialog', () => {
    expect(markup).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*>Facilities and equipment<\/button>/u,
    )
  })

  it('sends "See all" to the Inbox on the days the figure counted over', () => {
    const link = markup.match(
      /<a [^>]*href="(\/inbox\?[^"]*)"[^>]*>See all 19 reviews<\/a>/u,
    )

    expect(link?.[1]).toContain(`propertyId=${PROPERTY_ID}`)
    expect(link?.[1]).toContain('since=2026-07-31')
    expect(link?.[1]).toContain('until=2026-10-29')
  })

  it('narrows the Inbox to the issue, and to the reviews that complain of it', () => {
    const link = markup.match(
      /<a [^>]*href="(\/inbox\?[^"]*)"[^>]*>See all 19 reviews<\/a>/u,
    )

    expect(link?.[1]).toContain('issue=a0000000-0000-4000-8000-000000000001')
    expect(link?.[1]).toContain('polarity=negative')
  })

  it('underlines a complaint in the negative ink and praise in the positive', () => {
    const complaint = markup.match(/<mark class="([^"]*)">[^<]*air conditioning/u)
    const praise = markup.match(/<mark class="([^"]*)">The front desk team/u)

    expect(complaint?.[1]).toContain('decoration-negative')
    expect(praise?.[1]).toContain('decoration-positive')
    expect(complaint?.[1]).toContain('underline')
  })

  it('has no Urgent strip while nothing is urgent', () => {
    expect(markup).not.toContain('needs you')
    expect(markup).not.toContain('Urgent ·')
  })

  it('draws "Not right?" only where something will answer it', () => {
    expect(markup).not.toContain('Not right?')
    expect(body(LARGE_READ, { notRight: true })).toContain('Not right?')
  })

  it('puts the watch list in quiet chips with their counts', () => {
    expect(markup).toContain('Noise')
    expect(markup).toContain(' · 2 reviews')
    expect(markup).toContain(' · 1 review<')
  })

  it('says staff praise in one neutral line that names no one', () => {
    expect(markup).toContain('4 reviews praise a team member by name')
    expect(markup).toContain('read them')
    expect(
      body({ ...LARGE_READ, staffPraise: { reviewCount: 1, inboxHref: '/inbox' } }),
    ).toContain('1 review praises a team member by name')
    expect(body({ ...LARGE_READ, staffPraise: null })).not.toContain('team member')
  })

  it('shows the twelve topics with counts first and a percent beside them', () => {
    expect(markup).toContain('aria-label="Every topic"')
    expect(markup.match(/<tr[ >]/gu)).toHaveLength(13)
    expect(markup).toContain('100 of 128')
    expect(markup).toContain(' · 78%')
  })

  it('keeps the bars of praise and complaints to the topics with enough reviews', () => {
    // Safety has two reviews: counts only, no bar.
    const row = markup.split('<tr').find((part) => part.includes('Safety'))
    expect(row).toBeDefined()
    expect(row).not.toContain('data-slot="topic-bar"')
    expect(row).toContain('too few')
    expect(markup.match(/data-slot="topic-bar"/gu)?.length).toBe(11)
  })
})

describe('what is said where there is nothing to say', () => {
  it('has a line, not a gap, for a section with nothing in it', () => {
    const quiet = body({
      ...LARGE_READ,
      fixFirst: [],
      watch: [],
      guestsLove: [],
      staffPraise: null,
      whatChanged: [],
      everyTopic: [],
      inShort: [],
    })

    expect(quiet).toContain(
      'No problem is named in three or more reviews in this period.',
    )
    expect(quiet).toContain('Nothing is praised in enough reviews to report yet.')
    expect(quiet).toContain('Nothing has changed by more than its usual ups and downs.')
    expect(quiet).toContain('No topic was named in this period.')
    // The watch list is not a section to show empty; nor is the page's summary.
    expect(headings(quiet)).not.toContain('Watch')
    expect(headings(quiet)).not.toContain('In short')
  })

  it('says changes wait for the analysis while reviews are still being read', () => {
    const markup = body(PROVISIONAL_READ)

    expect(markup).toContain(
      'Some reviews are still being analysed, so these figures can still move',
    )
    expect(markup).toContain('Changes appear once your reviews are analysed.')
    expect(body(LARGE_READ)).not.toContain('still being analysed')
  })
})

describe('the guesthouse page', () => {
  const markup = body(SMALL_READ)

  it('names the whole year as the window and the three other things it holds', () => {
    expect(markup).toContain(
      'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36 reviews with text (plus 14 without text).',
    )
  })

  it('claims no trend where the engine cannot judge one', () => {
    expect(markup).toContain('Too few reviews for a trend')
    expect(markup).not.toContain('Rising')
    expect(markup).not.toContain('Falling')
  })
})

describe('the Urgent page', () => {
  const markup = body(URGENT_READ)

  it('puts the Urgent review above everything, with its reason, as a region and not an alert', () => {
    expect(markup.indexOf('An urgent review needs you')).toBeLessThan(
      markup.indexOf('chosen because'),
    )
    expect(markup).toMatch(/<div[^>]*role="region"[^>]*aria-labelledby/u)
    expect(markup).not.toContain('role="alert"')
    expect(markup).toContain('Urgent · safety')
    expect(markup).toContain('Balcony railing')
  })

  it('opens the Inbox on the urgent reviews of the property, whatever the window', () => {
    const link = markup.match(
      /<a [^>]*href="(\/inbox\?[^"]*)"[^>]*>Open urgent reviews in the inbox/u,
    )

    expect(link?.[1]).toContain('attention=urgent')
    expect(link?.[1]).toContain(`propertyId=${PROPERTY_ID}`)
    expect(link?.[1]).not.toContain('since=')
  })

  it('counts an Urgent review that names no problem, beside the cards, never dropping it', () => {
    const counted = body({ ...URGENT_READ, urgentOtherCount: 2 })

    expect(counted).toContain('Urgent reviews need you')
    expect(counted).toContain('2 more urgent reviews name no problem to open here.')
    expect(counted).toContain('Balcony railing')
  })

  it('still draws the strip when only such reviews are Urgent', () => {
    const only = body({ ...LARGE_READ, urgentOtherCount: 1 })

    expect(only).toContain('An urgent review needs you')
    expect(only).toContain('1 urgent review names no problem to open here.')
    expect(only).toContain('Open urgent reviews in the inbox')
    expect(only).not.toContain('Urgent ·')
  })

  it('says "Urgent reviews need you" for more than one', () => {
    const [first] = URGENT_READ.urgent
    if (first === undefined) throw new Error('The Urgent fixture has no issue')
    const two = body({
      ...URGENT_READ,
      urgent: [
        first,
        { ...first, issueId: 'second', urgentReason: 'health', title: 'Seafood' },
      ],
    })

    expect(two).toContain('Urgent reviews need you')
    expect(two).toContain('Urgent · health')
  })
})

describe('the page of a property with too few reviews', () => {
  const markup = body(NOT_ENOUGH_READ)

  it('says why there are no patterns, and what it has instead', () => {
    expect(markup).toContain('Not enough reviews yet to spot patterns')
    expect(markup).toContain('This property has 4 reviews')
    expect(headings(markup)).toEqual(['Latest reviews'])
    expect(markup).not.toContain('Fix first')
  })

  it('shows a review that names a person as its stars, its day and the way to the Inbox', () => {
    const items = markup.split('<li').slice(1)

    expect(items).toHaveLength(4)
    const withheld = items.find((item) => item.includes('Sep 30, 2026'))
    expect(withheld).toContain('Open in the inbox')
    expect(withheld).not.toMatch(/<p class="text-sm leading-relaxed/u)
  })

  it('says "none" for a property with no review with text at all', () => {
    const none = body({ ...NOT_ENOUGH_READ, textReviewCount: 0, latestReviews: [] })

    expect(none).toContain('This property has none')
    expect(none).toContain('No reviews have come in yet.')
  })
})
