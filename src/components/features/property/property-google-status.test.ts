// A Property's Google link reads the same wherever it is a pill.
//
// Property settings drew it twice, from two tables: "Not linked" in a warn pill
// under Google connection, "No Google profile linked" in a neutral pill in the
// Danger zone. Both now draw `GOOGLE_BINDING_STATUS`.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Action } from '#/components/hooks/use-action'

vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

import { PropertyLifecycleCard } from './property-lifecycle-card'
import {
  GOOGLE_BINDING_STATUS,
  type GoogleBindingState,
} from './property-lifecycle-model'
import { PropertyGoogleSection } from './settings/property-google-section'

const STATES = Object.keys(GOOGLE_BINDING_STATUS) as GoogleBindingState[]
const PROPERTY_ID = 'property-1'

const idle = <TInput>(): Action<TInput> =>
  Object.assign(async (_input: TInput): Promise<unknown> => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

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

/** Every status pill in the markup, as its tone and its words. */
function pillsOf(markup: string): Array<{ tone: string; label: string }> {
  const pills = markup.matchAll(
    /<span data-slot="badge" data-variant="(\w+)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/span>/gu,
  )
  return [...pills].map((pill) => ({ tone: pill[1] ?? '', label: pill[2] ?? '' }))
}

const googleSection = (googleBindingState: GoogleBindingState) =>
  render(
    createElement(PropertyGoogleSection, {
      property: { id: PROPERTY_ID, lifecycleState: 'active', googleBindingState },
    }),
  )

const lifecycleCard = (googleBindingState: GoogleBindingState) =>
  render(
    createElement(PropertyLifecycleCard, {
      property: {
        id: PROPERTY_ID,
        name: 'Harborline Suites',
        lifecycleState: 'active',
        lifecycleReason: null,
        purgeScheduledFor: null,
        googleBindingState,
      },
      responsibilityNeeded: false,
      actions: { archive: idle(), remove: idle(), restore: idle(), disconnect: idle() },
      permissions: { archive: true, restore: true, disconnect: true },
    }),
  )

describe("a Property's Google link as a pill", () => {
  it.each(STATES)(
    'reads the same under Google connection and in the Danger zone: %s',
    (state) => {
      const pill = GOOGLE_BINDING_STATUS[state]

      expect(pillsOf(googleSection(state))).toEqual([pill])
      expect(pillsOf(lifecycleCard(state))).toContainEqual(pill)
    },
  )

  it('says what the pill is about where the card around it is not about Google', () => {
    expect(lifecycleCard('unbound')).toContain('Google')
  })

  // The words are the ones Google connection always used. A Property with no
  // Business Profile cannot publish a Portal, so the missing link is something
  // to act on, as the Properties list already shows it.
  it('names each state in its own words and draws every state but linked as needing attention', () => {
    expect(GOOGLE_BINDING_STATUS).toEqual({
      active: { label: 'Linked', tone: 'positive' },
      account_confirmation_required: { label: 'Confirmation needed', tone: 'warn' },
      disconnected: { label: 'Disconnected', tone: 'warn' },
      unbound: { label: 'Not linked', tone: 'warn' },
    })
  })

  it('keeps the sentence under the title that says what the state means', () => {
    expect(googleSection('unbound')).toContain(
      'No Business Profile is linked to this property yet.',
    )
    expect(googleSection('disconnected')).toContain(
      'Reviews no longer sync. Relink the Business Profile to resume.',
    )
  })

  it('offers linking as the primary action only while the Property is not linked', () => {
    expect(googleSection('active')).toContain('Relink with Google import')
    expect(googleSection('active')).toContain('data-variant="outline"')
    expect(googleSection('unbound')).toContain('Link with Google import')
    expect(googleSection('unbound')).toContain('data-variant="default"')
  })
})
