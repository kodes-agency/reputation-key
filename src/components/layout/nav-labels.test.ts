// The words a destination goes by (UI consistency scan: FRAME-09, NAV-10, NAV-11).
//
// The sidebar named a place "Property settings" and its breadcrumb "Settings"; the
// same noun (Profile, AI, People, Google) meant a different scope in the account
// settings, a Property's settings and the sidebar. `NAV_LABEL` is where the sidebar
// takes its names and the breadcrumbs take theirs, and the settings sections of one
// Property name their scope, so no two destinations read the same.
import { describe, expect, it } from 'vitest'
import { PROPERTY_SETTINGS_SECTIONS } from '#/components/features/property/settings/property-settings-sections'
import { NAV_LABEL } from './nav-labels'

describe('NAV_LABEL', () => {
  it('is sentence case: a label never capitalises a word after its first', () => {
    for (const label of Object.values(NAV_LABEL)) {
      expect(label).toMatch(/^[A-Z][a-z]*( [a-z]+)*$/u)
    }
  })

  it('names no two destinations the same', () => {
    const labels = Object.values(NAV_LABEL)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('the sections of a Property’s settings', () => {
  const labels = PROPERTY_SETTINGS_SECTIONS.map((section) => section.label)

  it('name no destination of the sidebar, whose scope is another', () => {
    // The sidebar's People is who works at the Property, its Google is how the
    // Property performs there; a settings section of the same name is something else.
    const sidebar = [NAV_LABEL.people, NAV_LABEL.google, NAV_LABEL.overview] as string[]
    expect(labels.filter((label) => sidebar.includes(label))).toEqual([])
  })

  it('name no account settings page either: Profile and AI are the person’s and the Organization’s', () => {
    expect(labels).not.toContain('Profile')
    expect(labels).not.toContain('AI')
    expect(labels).not.toContain('AI overview')
  })

  it('name the Property or what they hold', () => {
    expect(labels).toEqual([
      'Property profile',
      'Google connection',
      'Replies',
      'AI features',
      'Responsible managers',
      'Targets',
      'Danger zone',
    ])
  })
})
