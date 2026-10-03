import { describe, expect, it } from 'vitest'
import { publicationSource } from './__fixtures__/publication-source'
import {
  PORTAL_CONFIGURATION_FIELDS,
  evaluatePortalConfigurationCompleteness,
} from './portal-configuration-completeness'
import type { PortalPublicationSource } from './portal-publication-source'

const evaluate = (
  source: PortalPublicationSource,
  googleReviewDestinationVerified = true,
) => evaluatePortalConfigurationCompleteness({ source, googleReviewDestinationVerified })

const base = publicationSource()

describe('evaluatePortalConfigurationCompleteness', () => {
  it('counts a Portal the Immersive Hub can show in full as complete', () => {
    expect(evaluate(publicationSource())).toEqual({
      fieldSet: 'immersive_hub',
      missing: [],
      completedFields: 5,
      requiredFields: 5,
    })
  })

  it('requires exactly the five Immersive Hub fields', () => {
    expect(PORTAL_CONFIGURATION_FIELDS).toEqual([
      'portal_name',
      'primary_wording',
      'property_look',
      'linktree_link',
      'google_destination',
    ])
  })

  it('misses the name of a Portal that has none', () => {
    const source = publicationSource({
      portal: { ...base.portal, name: '  ' },
    })

    expect(evaluate(source).missing).toEqual(['portal_name'])
  })

  it.each([
    ['welcome line', { title: null }],
    ['link preview', { shortDescription: '' }],
  ] as const)('misses the primary wording without its %s', (_text, gap) => {
    const source = publicationSource({
      wording: {
        ...base.wording,
        en: { ...base.wording.en!, ...gap },
      },
    })

    expect(evaluate(source)).toMatchObject({
      missing: ['primary_wording'],
      completedFields: 4,
    })
  })

  it('misses the primary wording when a link has no label in the primary language', () => {
    const [first, second] = base.links
    const source = publicationSource({
      links: [first!, { ...second!, texts: { bg: second!.texts.bg } }],
    })

    expect(evaluate(source).missing).toEqual(['primary_wording'])
  })

  it('reads another language with a gap as complete: guests read the primary text there', () => {
    const source = publicationSource({
      wording: {
        ...base.wording,
        bg: { title: null, shortDescription: null, heroAlt: null, linktreeTitle: null },
      },
    })

    expect(evaluate(source).missing).toEqual([])
  })

  it('misses the look of a Property with no Brand Profile', () => {
    expect(evaluate(publicationSource({ look: null })).missing).toEqual(['property_look'])
  })

  it.each([
    ['public display name', { displayName: ' ' }],
    ['accent colour', { accentColour: '' }],
  ] as const)('misses the look without its %s', (_part, gap) => {
    const source = publicationSource({ look: { ...base.look!, ...gap } })

    expect(evaluate(source).missing).toEqual(['property_look'])
  })

  it('counts a look without a logo, wordmark or photograph as complete', () => {
    const source = publicationSource({
      look: { ...base.look!, logo: null, wordmark: null, hero: null },
    })

    expect(evaluate(source).missing).toEqual([])
  })

  it.each([
    ['the Linktree is switched off', { linktreeEnabled: false }],
    ['no link has an approved destination', { links: [] }],
  ] as const)('misses the Linktree link when %s', (_case, gap) => {
    expect(evaluate(publicationSource(gap)).missing).toEqual(['linktree_link'])
  })

  it('misses the Google destination while it is not verified', () => {
    expect(evaluate(publicationSource(), false)).toMatchObject({
      missing: ['google_destination'],
      completedFields: 4,
    })
  })

  it('names every gap, in field order', () => {
    const source = publicationSource({
      portal: { ...base.portal, name: '' },
      wording: {},
      look: null,
      linktreeEnabled: false,
    })

    expect(evaluate(source, false)).toEqual({
      fieldSet: 'immersive_hub',
      missing: [...PORTAL_CONFIGURATION_FIELDS],
      completedFields: 0,
      requiredFields: 5,
    })
  })
})
