import { describe, expect, it } from 'vitest'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import {
  INITIAL_TEMPLATE_REQUESTS,
  isLiveTemplateRequest,
  retargetTemplateRequests,
  settleTemplateRequest,
  startTemplateRequest,
  templateTitleIn,
} from './use-reply-template'

const APPRECIATION_ID = '73000000-0000-4000-8000-000000000001'
const APOLOGY_ID = '73000000-0000-4000-8000-000000000002'

const library: ReplyTemplateListResult = {
  profile: null,
  groups: [
    {
      languageGroup: 'bg-Cyrl',
      templates: [
        {
          id: APPRECIATION_ID,
          title: 'Guest appreciation',
          aspect: null,
          openLabel: null,
          languageTag: 'bg-Cyrl',
          version: 3,
        },
        {
          id: APOLOGY_ID,
          title: 'Service apology',
          aspect: null,
          openLabel: null,
          languageTag: 'bg-Cyrl',
          version: 1,
        },
      ],
    },
  ],
  recommendedTemplateId: APPRECIATION_ID,
}

describe('template title resolution (row 18)', () => {
  it('resolves a loaded id to its title in the library it was loaded from', () => {
    expect(templateTitleIn(library, APOLOGY_ID)).toBe('Service apology')
  })

  it('resolves an id absent from the library to no title', () => {
    expect(templateTitleIn(library, '73000000-0000-4000-8000-00000000ffff')).toBeNull()
  })

  it('resolves to no title when no library was fetched', () => {
    expect(templateTitleIn(null, APPRECIATION_ID)).toBeNull()
  })

  it('resolves to no title in a library with no templates for the language', () => {
    expect(
      templateTitleIn(
        { profile: null, groups: [], recommendedTemplateId: null },
        APPRECIATION_ID,
      ),
    ).toBeNull()
  })
})

/**
 * The request ledger behind `useReplyTemplate`'s `isLoading`. The hook clears
 * `isLoading` in two places only: the `finally` of the LIVE request, and a
 * target change that discards one (`discarded: true`). A request dropped any
 * other way leaves the composer's textarea, Submit and every assist trigger
 * disabled until the manager leaves the item — the stuck state these pin.
 */
describe('template request ledger', () => {
  it('discards the live request when the target moves back before it returns (A → B → A)', () => {
    // A: the Bulgarian list loads and settles (the hook caches it).
    const bulgarian = startTemplateRequest(INITIAL_TEMPLATE_REQUESTS, 'property_default')
    const cached = settleTemplateRequest(bulgarian, bulgarian.sequence)
    // B: `Detect automatically` in the switch asks for the review list in the
    // same event that moves the target, so the move keeps the request.
    const review = startTemplateRequest(cached, 'review_language')
    const moved = retargetTemplateRequests(review, 'review_language')
    expect(moved.discarded).toBe(false)
    expect(isLiveTemplateRequest(moved.ledger, review.sequence)).toBe(true)

    // A again, before B returns: the cache answers, no request starts, and the
    // target moves back — the review request must be discarded AND reported.
    const back = retargetTemplateRequests(moved.ledger, 'property_default')

    expect(back.discarded).toBe(true)
    expect(isLiveTemplateRequest(back.ledger, review.sequence)).toBe(false)
  })

  it('discards the live request when the target becomes none (a saved-draft language)', () => {
    const live = startTemplateRequest(INITIAL_TEMPLATE_REQUESTS, 'property_default')

    const moved = retargetTemplateRequests(live, null)

    expect(moved.discarded).toBe(true)
    expect(isLiveTemplateRequest(moved.ledger, live.sequence)).toBe(false)
  })

  it('reports nothing discarded when no request is in flight', () => {
    const live = startTemplateRequest(INITIAL_TEMPLATE_REQUESTS, 'property_default')
    const settled = settleTemplateRequest(live, live.sequence)

    expect(retargetTemplateRequests(settled, 'review_language').discarded).toBe(false)
  })

  it('lets a newer request supersede an older one without settling it', () => {
    const first = startTemplateRequest(INITIAL_TEMPLATE_REQUESTS, 'property_default')
    const second = startTemplateRequest(first, 'property_default')

    expect(isLiveTemplateRequest(second, first.sequence)).toBe(false)
    // A stale settle leaves the newer request live.
    expect(settleTemplateRequest(second, first.sequence)).toBe(second)
  })

  it('returns new ledgers rather than changing the one it was given', () => {
    const live = startTemplateRequest(INITIAL_TEMPLATE_REQUESTS, 'review_language')

    retargetTemplateRequests(live, 'property_default')

    expect(INITIAL_TEMPLATE_REQUESTS).toEqual({ sequence: 0, liveKind: null })
    expect(live).toEqual({ sequence: 1, liveKind: 'review_language' })
  })
})
