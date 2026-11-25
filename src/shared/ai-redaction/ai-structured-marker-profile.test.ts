import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADDRESS_MARKER_PROFILE } from './ai-address-markers'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'

describe('structured marker address policy attestation', () => {
  afterEach(() => {
    vi.doUnmock('./ai-address-markers')
    vi.resetModules()
  })

  it.each([
    {
      name: 'address algorithm',
      profile: { ...ADDRESS_MARKER_PROFILE, algorithm: 'changed-address-policy' },
    },
    {
      name: 'name word patterns',
      profile: {
        ...ADDRESS_MARKER_PROFILE,
        nameRules: { ...ADDRESS_MARKER_PROFILE.nameRules, patterns: [] },
      },
    },
    {
      name: 'open street types',
      profile: {
        ...ADDRESS_MARKER_PROFILE,
        nameRules: { ...ADDRESS_MARKER_PROFILE.nameRules, openStreetTypes: [] },
      },
    },
    {
      name: 'plain name word limit',
      profile: {
        ...ADDRESS_MARKER_PROFILE,
        nameRules: { ...ADDRESS_MARKER_PROFILE.nameRules, maxPlainNameWords: 1 },
      },
    },
    {
      name: 'abbreviated street types',
      profile: { ...ADDRESS_MARKER_PROFILE, abbreviatedTypes: [] },
    },
  ])('changes the detector digest when $name change', async ({ profile }) => {
    vi.resetModules()
    vi.doMock('./ai-address-markers', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./ai-address-markers')>()),
      ADDRESS_MARKER_PROFILE: profile,
    }))
    const changed = await import('./ai-structured-marker-detectors')
    expect(changed.AI_STRUCTURED_MARKER_DETECTORS_DIGEST).not.toBe(
      AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
    )
  })
})
