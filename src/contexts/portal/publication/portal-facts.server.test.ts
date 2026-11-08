import { describe, expect, it } from 'vitest'
import { buildLocaleSetFact, buildPortalHealthFact } from './portal-facts.server'

const at = new Date('2026-01-02T03:04:05.000Z')
const base = { id: 'h1', sourceVersion: at.toISOString(), at }

describe('buildPortalHealthFact', () => {
  it('reports a published Portal with a responsible manager as healthy', () => {
    const fact = buildPortalHealthFact({
      ...base,
      publicationState: 'published',
      hasResponsibleManager: true,
    })
    expect(fact.value).toEqual({ status: 'healthy', reason: 'operational' })
    expect(fact.effectiveAt).toBe(at)
    expect(fact.observedAt).toBe(at)
  })

  it('degrades a published Portal nobody is responsible for', () => {
    const fact = buildPortalHealthFact({
      ...base,
      publicationState: 'published',
      hasResponsibleManager: false,
    })
    expect(fact.value.reason).toBe('responsibility_needed')
  })

  it('reports an unpublished Portal as unavailable whatever the manager', () => {
    const fact = buildPortalHealthFact({
      ...base,
      publicationState: 'draft',
      hasResponsibleManager: true,
    })
    expect(fact.value).toEqual({ status: 'unavailable', reason: 'publication_draft' })
  })
})

describe('buildLocaleSetFact', () => {
  const before = {
    id: 'p1',
    organizationId: 'o1',
    propertyId: 'pr1',
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['de'],
  } as never

  it('returns nothing when the guest languages are unchanged', () => {
    expect(
      buildLocaleSetFact(
        before,
        { primaryGuestLocale: 'en', additionalGuestLocales: ['de'] } as never,
        at,
        at,
      ),
    ).toBeUndefined()
  })

  it('returns the fact when an additional language is added', () => {
    const fact = buildLocaleSetFact(
      before,
      { primaryGuestLocale: 'en', additionalGuestLocales: ['de', 'fr'] } as never,
      at,
      at,
    )
    expect(fact).toBeDefined()
  })
})
