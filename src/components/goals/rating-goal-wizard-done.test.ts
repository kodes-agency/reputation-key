// The Google rating goal's done screen, drawn: what was set, "Go to goals", and
// one next step on the portal side (PLAN PG-11, D-1 and D-2). Once a Portal is
// live it is the monthly portal goal's card, which every Property has, so the
// step is never a dead end; a draft, disabled or archived Portal is not live,
// and the step is then a first Portal.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { PortalPublicationState } from '#/contexts/portal/domain/portal-publication'
import { Dialog } from '#/components/ui/dialog'
import { PortalGoalSection } from './portal-goal-section'
import { portalNextStepOf } from './rating-goal-portal-step'
import { PORTAL_GOALS_TITLE_ID, RatingGoalDone } from './rating-goal-wizard-done'

const PROPERTY_ID = 'p1'

function withRouter(child: ReactElement): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: child }),
  )
}

/** The done screen for a Property whose Portals are in these states. */
function renderDone(states: readonly PortalPublicationState[]): string {
  return withRouter(
    createElement(
      Dialog,
      { open: true },
      createElement(RatingGoalDone, {
        receipt: { headline: '4.1 on Google', pace: null, forecast: null },
        propertyId: PROPERTY_ID,
        portalNextStep: portalNextStepOf(
          states.map((publicationState) => ({ publicationState })),
        ),
        onSeePortalGoal: () => undefined,
      }),
    ),
  )
}

/** A link with these words, to this address, anywhere in the markup. */
const linkTo = (href: string, words: string) =>
  new RegExp(`<a[^>]*href="${href}"[^>]*>${words}</a>`, 'u')

describe('RatingGoalDone', () => {
  it('offers See your portal goal with a live portal', () => {
    const html = renderDone(['draft', 'published', 'archived'])

    expect(html).toContain('4.1 on Google')
    expect(html).toContain('Go to goals')
    expect(html).toMatch(
      linkTo(`/properties/${PROPERTY_ID}/goals#portal-goals`, 'See your portal goal'),
    )
    expect(html).not.toContain('Create a portal')
    expect(html).not.toContain('Set portal goals')
  })

  it.each([
    { portals: [] },
    { portals: ['draft'] },
    { portals: ['draft', 'disabled', 'archived'] },
  ] satisfies ReadonlyArray<{ portals: PortalPublicationState[] }>)(
    'offers Create a portal with none or only drafts ($portals)',
    ({ portals }) => {
      const html = renderDone(portals)

      expect(html).toMatch(
        linkTo(`/properties/${PROPERTY_ID}/portals/new`, 'Create a portal'),
      )
      expect(html).toContain('Go to goals')
      expect(html).not.toContain('See your portal goal')
      expect(html).not.toContain('Set portal goals')
    },
  )

  it('lands on the Portal goals section, whose title can take the focus', () => {
    const html = withRouter(
      createElement(PortalGoalSection, {
        propertyId: PROPERTY_ID,
        card: null,
        canCreatePortal: false,
        commands: {
          setMonthlyPortalGoalFn: async () => undefined,
          onSet: async () => undefined,
        },
      }),
    )

    expect(html).toContain('id="portal-goals"')
    expect(html).toMatch(
      new RegExp(`<h2[^>]*id="${PORTAL_GOALS_TITLE_ID}"[^>]*tabindex="-1"`, 'u'),
    )
  })
})
