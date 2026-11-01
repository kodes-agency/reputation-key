import { describe, expect, it } from 'vitest'
import type { PortalGoalPageView } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { whereBand } from './portal-goal-bands-view'
import { PORTAL_NO_SCAN_HINT } from './portal-goal-copy'
import { fromPortalsWords } from './portal-goal-page-view'
import {
  PAGE_LATER,
  PAGE_ONE_PORTAL,
  PAGE_RUNNING,
  PAGE_SCANS,
  PAGE_WITH_NO_SCAN_FACTS,
} from './portal-goal-page.stories.fixtures'

const wordsOf = (page: PortalGoalPageView) =>
  fromPortalsWords(page.rows, page.facts, page.portals)

/** The Portals' counts of the month, as the read gives them. */
const counts = (
  ...each: readonly [string, number][]
): NonNullable<PortalGoalPageView['rows']> => ({
  portals: each.map(([name, count]) => ({ portalId: `portal-${name}`, name, count })),
  elsewhere: 0,
  total: each.reduce((total, [, count]) => total + count, 0),
  truncated: false,
})

describe('whereBand: where are they coming from?', () => {
  it('names a Portal that has gone quiet, and the one question to ask of it', () => {
    expect(whereBand(wordsOf(PAGE_WITH_NO_SCAN_FACTS))).toEqual({
      title: 'Where are they coming from?',
      icon: 'where',
      answer: 'Spa has gone quiet',
      hint: `Spa: no scans since Nov 15. It usually gets about 7 a week. ${PORTAL_NO_SCAN_HINT}`,
      tone: 'warn',
    })
  })

  it('counts several quiet Portals without naming each', () => {
    const page = {
      ...PAGE_RUNNING,
      facts: {
        'portal-reception': { noScansSince: '2026-11-08', usualPerWeek: 12 },
        'portal-spa': { noScansSince: '2026-11-15', usualPerWeek: 7 },
      },
    }

    expect(whereBand(wordsOf(page))).toMatchObject({
      answer: '2 portals have gone quiet',
      hint: PORTAL_NO_SCAN_HINT,
      tone: 'warn',
    })
  })

  it('says a quiet Portal even where the counts are not shown', () => {
    const band = whereBand(wordsOf({ ...PAGE_WITH_NO_SCAN_FACTS, rows: null }))

    expect(band).toMatchObject({ answer: 'Spa has gone quiet', tone: 'warn' })
  })

  it('has nothing to say with no counts that add up and no Portal gone quiet', () => {
    expect(whereBand(wordsOf(PAGE_SCANS))).toBeNull()
  })

  it('says nothing came in yet, when every Portal is on none', () => {
    const none = counts(['Reception', 0], ['Restaurant', 0], ['Spa', 0])

    expect(whereBand(wordsOf({ ...PAGE_RUNNING, rows: none }))).toMatchObject({
      answer: 'Nothing yet this month',
      hint: null,
      tone: 'neutral',
    })
    expect(
      whereBand(wordsOf({ ...PAGE_ONE_PORTAL, rows: counts(['Reception', 0]) })),
    ).toMatchObject({ answer: 'Nothing yet this month' })
  })

  it('names the one Portal there is, in the positive tone', () => {
    expect(whereBand(wordsOf(PAGE_ONE_PORTAL))).toMatchObject({
      answer: 'All from Reception',
      hint: null,
      tone: 'positive',
    })
  })

  it('says every Portal is bringing them in, and none has gone quiet', () => {
    expect(whereBand(wordsOf(PAGE_LATER))).toMatchObject({
      answer: 'All 3 portals are bringing them in',
      hint: 'No portal has gone quiet.',
      tone: 'positive',
    })
  })

  it('counts what disabled Portals brought in as no Portal of its own', () => {
    const rows = {
      ...counts(['Reception', 13], ['Restaurant', 6], ['Spa', 2]),
      elsewhere: 2,
    }

    expect(whereBand(wordsOf({ ...PAGE_RUNNING, rows }))).toMatchObject({
      answer: 'All 3 portals are bringing them in',
    })
  })

  it('never says "all from" or "nothing yet" while other Portals brought some in', () => {
    const elsewhere = (rows: NonNullable<typeof PAGE_RUNNING.rows>) => ({
      ...rows,
      elsewhere: 3,
    })

    expect(
      whereBand(
        wordsOf({ ...PAGE_ONE_PORTAL, rows: elsewhere(counts(['Reception', 10])) }),
      ),
    ).toMatchObject({ answer: 'From Reception and other portals', tone: 'neutral' })
    expect(
      whereBand(
        wordsOf({
          ...PAGE_RUNNING,
          rows: elsewhere(counts(['Reception', 0], ['Spa', 0])),
        }),
      ),
    ).toMatchObject({ answer: 'All from other portals', tone: 'neutral' })
  })

  it('says how many of the Portals are bringing them in, when some are on none', () => {
    expect(whereBand(wordsOf(PAGE_RUNNING))).toEqual({
      title: 'Where are they coming from?',
      icon: 'where',
      answer: 'From 2 of your 3 portals',
      hint: null,
      tone: 'neutral',
    })
  })

  it('never names a winner: only a Portal gone quiet is named, and nothing is ranked', () => {
    const otherPortals = { ...counts(['Reception', 13], ['Restaurant', 6]), elsewhere: 4 }
    const said = [PAGE_RUNNING, PAGE_LATER, { ...PAGE_RUNNING, rows: otherPortals }]
      .map((page) => whereBand(wordsOf(page)))
      .map((band) => `${band?.answer} ${band?.hint ?? ''}`)
    const quiet = whereBand(wordsOf(PAGE_WITH_NO_SCAN_FACTS))

    for (const words of [...said, `${quiet?.answer} ${quiet?.hint}`]) {
      expect(words).not.toMatch(/Reception|Restaurant|Other portals/u)
      expect(words).not.toMatch(
        /\b(most|top|best|biggest|highest|leading|winner|first)\b/iu,
      )
    }
    expect(said.join(' ')).not.toMatch(/Spa/u)
  })
})
