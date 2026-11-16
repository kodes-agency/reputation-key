import { describe, expect, it } from 'vitest'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { resolveSettingsFields } from './portal-intents.server'

describe('resolveSettingsFields', () => {
  const existing = buildTestPortal({
    name: 'Existing',
    description: 'Existing description',
    heroImageUrl: 'https://cdn.example.com/hero.png',
    theme: { primaryColor: '#112233' },
  })

  it('keeps every existing value when the keys are absent', () => {
    const fields = resolveSettingsFields({ portalId: existing.id }, existing)

    expect(fields).toEqual({
      name: 'Existing',
      description: 'Existing description',
      heroImageUrl: 'https://cdn.example.com/hero.png',
      theme: { primaryColor: '#112233' },
      privateFeedbackThreshold: 3,
      skipPrivateRating: false,
      contactRequestsEnabled: false,
    })
  })

  it('treats an explicit null as "clear this field", not "leave unchanged"', () => {
    const fields = resolveSettingsFields(
      { portalId: existing.id, description: null, heroImageUrl: null },
      existing,
    )

    expect(fields.description).toBeNull()
    expect(fields.heroImageUrl).toBeNull()
    // Untouched keys still fall back.
    expect(fields.name).toBe('Existing')
  })

  it('validates and updates the inclusive private-feedback threshold', () => {
    expect(
      resolveSettingsFields(
        { portalId: existing.id, privateFeedbackThreshold: 4 },
        existing,
      ).privateFeedbackThreshold,
    ).toBe(4)
    expect(() =>
      resolveSettingsFields(
        { portalId: existing.id, privateFeedbackThreshold: 0 },
        existing,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_threshold' }))
  })

  it('switches contact requests on and off, and keeps them when the key is absent', () => {
    expect(
      resolveSettingsFields(
        { portalId: existing.id, contactRequestsEnabled: true },
        existing,
      ).contactRequestsEnabled,
    ).toBe(true)
    const on = { ...existing, contactRequestsEnabled: true }
    expect(resolveSettingsFields({ portalId: on.id }, on).contactRequestsEnabled).toBe(
      true,
    )
    expect(
      resolveSettingsFields({ portalId: on.id, contactRequestsEnabled: false }, on)
        .contactRequestsEnabled,
    ).toBe(false)
  })

  it('validates values that are present', () => {
    expect(() =>
      resolveSettingsFields({ portalId: existing.id, name: '   ' }, existing),
    ).toThrow(expect.objectContaining({ code: 'invalid_name' }))
  })
})
