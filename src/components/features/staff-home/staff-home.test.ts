import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { StaffResultsView, StaffGoals, StaffColleagues } from './staff-results-view'
import { Dialog } from '#/components/ui/dialog'
import { StaffNoticeContent } from './staff-notice'
import { ownStaffParticipation } from './staff-home'
import type { StaffResults as StaffResultsData } from './types'
import { StaffHome } from './index'
import { StaffSurface } from './staff-surface'
import { StaffPass } from './staff-pass'
import { STAFF_SURFACE_CSS } from './staff-surface-styles'
import { StaffStoryScreen } from './staff-story-screen'
import { StaffCode, StaffCodeTile, StaffCodeView } from './staff-code'
import { StaffAccountMenu } from './staff-account-menu'
import { StaffResults } from './staff-results'
import { readStaffResults, staffResultsKey } from './use-staff-results'
import {
  STAFF_HOME_FIXTURE,
  STAFF_HOME_FNS,
  STAFF_RESULTS_FIXTURE,
} from './staff-home-fixtures'
import { createKeys } from '#/shared/queries/query-keys'
import { staffHomeSearch } from '#/shared/staff-home-search'

const { staffSelfKeys } = createKeys({ userId: 'polly', organizationId: null })

vi.mock('#/components/ui/inline-link', () => ({
  InlineLink: ({ to, children }: { to: string; children: unknown }) =>
    createElement('a', { href: to }, children as never),
}))

const LOOK = STAFF_HOME_FIXTURE.participations[0]!.look
const render = (
  period: 'today' | 'week' | 'month',
  results: StaffResultsData = STAFF_RESULTS_FIXTURE,
) => renderToStaticMarkup(createElement(StaffResultsView, { period, results }))
describe('staff home views', () => {
  it('shows a live code tile in its guest language without a guest link or address', () => {
    const html = renderToStaticMarkup(
      createElement(StaffCodeTile, {
        code: {
          state: 'live',
          qr: 'https://example.com/p/secret',
          wordingKey: 'bg',
          headline: 'Как мина престоят ви?',
          subline: 'Сподели',
          cue: 'Сканирайте с камерата',
        },
        look: LOOK,
        name: 'Harbor Hotel',
      }),
    )
    expect(html).toContain('Как мина престоят ви?')
    expect(html).toContain('Сподели')
    expect(html).toContain('Сканирайте с камерата')
    expect(html).toContain('Harbor Hotel')
    expect(html).not.toContain('secret')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('download')
  })
  it('replaces a paused code with its one plain sentence', () => {
    const html = renderToStaticMarkup(
      createElement(StaffCodeView, {
        code: { state: 'paused' },
        look: LOOK,
        name: 'Harbor',
      }),
    )
    expect(html).toContain('Your code is paused. Ask your manager.')
    expect(html).not.toContain('<img')
  })
  it('shows only scans and the morning sentence today', () => {
    const html = render('today')
    expect(html).toContain('Ratings update each morning.')
    expect(html).not.toContain('4.6')
    expect(html).not.toContain('Your ratings')
  })
  it('shows no average below five ratings and no praise or pace', () => {
    const html = render('week', {
      ...STAFF_RESULTS_FIXTURE,
      ratingCount: 3,
      averageRating: undefined,
    })
    expect(html).toContain('3 ratings so far')
    expect(html).toContain('Average shows after 5 ratings')
    expect(html).toContain('Up to last night')
  })
  it('shows the month numbers, including real zeroes', () => {
    expect(render('month')).toContain('Yes, 47 guests this month')
    expect(render('month')).toContain('4.6★ from 12 ratings')
    expect(render('month', { ...STAFF_RESULTS_FIXTURE, scans: 0 })).toContain(
      'Not yet this month',
    )
  })
  it('shows the completed previous month without the midnight note', () => {
    const html = renderToStaticMarkup(
      createElement(StaffResultsView, {
        period: 'last_month',
        results: STAFF_RESULTS_FIXTURE,
      }),
    )
    expect(html).toContain('4.6')
    expect(html).not.toContain('Up to last night')
  })
  it('omits an empty goal section and keeps scan meters neutral', () => {
    expect(renderToStaticMarkup(createElement(StaffGoals, { goals: [] }))).toBe('')
    const html = renderToStaticMarkup(
      createElement(StaffGoals, {
        goals: [{ id: 'g', name: '', scans: 47, target: 60 }],
      }),
    )
    expect(html).toContain('13 scans to go this month')
    expect(html).toContain('Your goal this month')
    expect(html).toContain('47 of 60 scans')
    expect(html).toContain('role="progressbar"')
    expect(html).not.toMatch(/\bpace\b|\bahead\b|\bbehind\b|well done/iu)
  })
  it('preserves server order, marks you and shows only scans', () => {
    const html = renderToStaticMarkup(
      createElement(StaffColleagues, {
        colleagues: [
          { displayName: 'Zoe', scans: 0, isYou: false },
          { displayName: 'Polly', scans: 47, isYou: true },
        ],
      }),
    )
    expect(html.indexOf('Zoe')).toBeLessThan(html.indexOf('Polly'))
    expect(html).toContain('you')
    expect(html).not.toContain('progressbar')
  })
  it('holds the exact notice and the privacy link before any code', () => {
    const html = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(StaffNoticeContent, {
          pending: false,
          error: null,
          onAccept: () => undefined,
        }),
      ),
    )
    expect(html).toContain('Before you start')
    expect(html).toContain(
      'Offer your code to every guest, not only those who seem happy.',
    )
    expect(html).toContain(
      'If your manager turns on the staff list, colleagues here can see your scan count.',
    )
    expect(html).toContain('Got it')
  })
  it('uses only an owned participation and defaults to Code and this month', () => {
    expect(ownStaffParticipation(STAFF_HOME_FIXTURE, 'somebody-else')).toEqual(
      STAFF_HOME_FIXTURE.participations[0],
    )
    expect(staffHomeSearch({ tab: 'other', period: [], p: 1 })).toEqual({
      tab: 'code',
      period: 'month',
      p: undefined,
    })
    expect(staffHomeSearch({ tab: 'results', period: 'week' }).period).toBe('week')
  })
  it('seeds the exact server cutoff, without a browser date', async () => {
    const client = new QueryClient()
    const result = await readStaffResults(
      client,
      { userId: 'polly', organizationId: null },
      STAFF_HOME_FNS.getMyResults,
      'own',
      'month',
    )
    expect(
      staffResultsKey(
        { userId: 'polly', organizationId: null },
        'own',
        'month',
        result,
      ).at(-1),
    ).toBe(STAFF_RESULTS_FIXTURE.ratingsCutoff)
    expect(
      client.getQueryData(
        staffResultsKey(
          { userId: 'polly', organizationId: null },
          'own',
          'month',
          result,
        ),
      ),
    ).toEqual(result)
    client.clear()
  })
  it('renders the seeded cutoff through the real result hook without a missing-query warning', () => {
    const client = new QueryClient()
    const participation = STAFF_HOME_FIXTURE.participations[0]!
    client.setQueryData(
      staffSelfKeys.resultsCurrent(participation.participationId, 'month'),
      STAFF_RESULTS_FIXTURE,
    )
    client.setQueryData(
      staffResultsKey(
        { userId: 'polly', organizationId: null },
        participation.participationId,
        'month',
        STAFF_RESULTS_FIXTURE,
      ),
      STAFF_RESULTS_FIXTURE,
    )
    client.setQueryData(staffSelfKeys.goals(participation.participationId), { goals: [] })
    const warning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(StaffResults, {
            participation,
            period: 'month',
            onPeriod: () => undefined,
            fns: STAFF_HOME_FNS,
          }),
        ),
      )
      expect(html).toContain('4.6')
      expect(warning).not.toHaveBeenCalled()
    } finally {
      warning.mockRestore()
      client.clear()
    }
  })
  it('exports the mounted feature parts', () => {
    expect(STAFF_SURFACE_CSS).toContain('100dvh')
    expect(
      [
        StaffHome,
        StaffSurface,
        StaffPass,
        StaffStoryScreen,
        StaffCode,
        StaffCodeTile,
        StaffCodeView,
        StaffResults,
        StaffAccountMenu,
      ].every((value) => typeof value === 'function'),
    ).toBe(true)
  })
})

vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'polly', organizationId: null }),
}))
