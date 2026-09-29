// The declared capability posture (ADR 0032, amended 2026-09-29). A fresh
// database seeds every Google content and AI capability control OFF, and
// nothing in production turned them back on, so every closed-beta reset
// silently broke "Connect Google" and AI. The deploy now lifts what the
// environment declares — but only an untouched seed default. A deliberate
// operator kill always wins over the declaration.

import { describe, expect, it } from 'vitest'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/domain/google-content-capability'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '#/shared/domain/merchant-ai-capability'
import {
  DeclaredCapabilityPostureError,
  decideAiCapabilityPosture,
  decideGoogleCapabilityPosture,
  formatDeclaredCapabilityPostureReport,
  parseDeclaredCapabilityPosture,
  type AiControlHeadSnapshot,
} from './declared-capability-posture'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

describe('parseDeclaredCapabilityPosture', () => {
  it('declares nothing when both variables are unset — the dark posture stays', () => {
    expect(parseDeclaredCapabilityPosture({})).toEqual({
      google: [],
      ai: [],
      candidateReleaseSha: null,
    })
  })

  it('treats blank and comma-only values as nothing declared', () => {
    expect(
      parseDeclaredCapabilityPosture({
        GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '  ',
        AI_CAPABILITIES_ENABLED: ' , ,',
      }),
    ).toEqual({ google: [], ai: [], candidateReleaseSha: null })
  })

  it('reads * as every capability of its kind', () => {
    const posture = parseDeclaredCapabilityPosture({
      GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '*',
      AI_CAPABILITIES_ENABLED: '*',
      RELEASE_SHA: SHA,
    })
    expect(posture.google).toEqual([...GOOGLE_CONTENT_CAPABILITIES])
    expect(posture.ai).toEqual([...CURRENT_MERCHANT_AI_CAPABILITIES])
  })

  it('keeps a listed subset in canonical order, trimmed and without duplicates', () => {
    const posture = parseDeclaredCapabilityPosture({
      GOOGLE_CONTENT_CAPABILITIES_ALLOWED:
        ' property.publish_reply ,property.connect_gbp,property.publish_reply',
      AI_CAPABILITIES_ENABLED: 'property_trends, review_analysis',
      RELEASE_SHA: SHA,
    })
    expect(posture.google).toEqual(['property.connect_gbp', 'property.publish_reply'])
    expect(posture.ai).toEqual(['review_analysis', 'property_trends'])
  })

  it('refuses an unknown Google capability by name, listing the vocabulary', () => {
    expect(() =>
      parseDeclaredCapabilityPosture({
        GOOGLE_CONTENT_CAPABILITIES_ALLOWED: 'property.connect_gbp,property.conect_gbp',
      }),
    ).toThrow(
      /GOOGLE_CONTENT_CAPABILITIES_ALLOWED names unknown capability "property\.conect_gbp".*property\.import_gbp_v2/,
    )
  })

  it('refuses an unknown AI capability by name', () => {
    expect(() =>
      parseDeclaredCapabilityPosture({
        AI_CAPABILITIES_ENABLED: 'review_analysis,ai.analyze',
        RELEASE_SHA: SHA,
      }),
    ).toThrow(/AI_CAPABILITIES_ENABLED names unknown capability "ai\.analyze"/)
  })

  it('still refuses a typo written next to *', () => {
    expect(() =>
      parseDeclaredCapabilityPosture({ AI_CAPABILITIES_ENABLED: '*,reply_draftng' }),
    ).toThrow(DeclaredCapabilityPostureError)
  })

  it('records RELEASE_SHA as the candidate the AI activation audits', () => {
    expect(
      parseDeclaredCapabilityPosture({
        AI_CAPABILITIES_ENABLED: 'review_analysis',
        RELEASE_SHA: SHA,
        IMAGE_SOURCE_REVISION: OTHER_SHA,
      }).candidateReleaseSha,
    ).toBe(SHA)
  })

  it('falls back to the revision baked into the image', () => {
    expect(
      parseDeclaredCapabilityPosture({
        AI_CAPABILITIES_ENABLED: 'review_analysis',
        RELEASE_SHA: 'unknown',
        IMAGE_SOURCE_REVISION: OTHER_SHA,
      }).candidateReleaseSha,
    ).toBe(OTHER_SHA)
  })

  it('refuses to declare AI without a 40-character release revision to record', () => {
    expect(() =>
      parseDeclaredCapabilityPosture({
        AI_CAPABILITIES_ENABLED: '*',
        RELEASE_SHA: 'unknown',
      }),
    ).toThrow(/AI_CAPABILITIES_ENABLED needs RELEASE_SHA/)
  })

  it('needs no release revision for a Google-only declaration', () => {
    expect(
      parseDeclaredCapabilityPosture({ GOOGLE_CONTENT_CAPABILITIES_ALLOWED: '*' }),
    ).toEqual({
      google: [...GOOGLE_CONTENT_CAPABILITIES],
      ai: [],
      candidateReleaseSha: null,
    })
  })
})

describe('decideGoogleCapabilityPosture', () => {
  it('lifts a capability that has no control row at all', () => {
    expect(decideGoogleCapabilityPosture(undefined)).toBe('lifted')
  })

  // The exact rows drizzle/0002_db_seed.sql inserts.
  it.each([
    [null, 'migration_default_deny'],
    ['migration:0124', 'organization_ownership_expand_default_deny'],
    ['migration:0124', 'reply_publication_provider_authority_default_deny'],
  ])('lifts the untouched seed denial (%s, %s)', (operatorId, reason) => {
    expect(decideGoogleCapabilityPosture({ denied: true, operatorId, reason })).toBe(
      'lifted',
    )
  })

  it('leaves an allowed capability alone', () => {
    expect(
      decideGoogleCapabilityPosture({
        denied: false,
        operatorId: 'owner:someone@example.com',
        reason: 'restored',
      }),
    ).toBe('already_allowed')
  })

  it.each(['owner:someone@example.com', 'incident-042', 'migrationless', 'deploy:x'])(
    'never overrides a denial made by an operator (%s)',
    (operatorId) => {
      expect(
        decideGoogleCapabilityPosture({
          denied: true,
          operatorId,
          reason: 'migration_default_deny',
        }),
      ).toBe('kept_operator_denied')
    },
  )

  it.each([
    ['a later migration that denies on purpose', 'migration:0200', 'incident'],
    ['a hand kill that left the operator blank', null, 'incident'],
    ['a denial with no recorded reason', null, null],
  ])('keeps %s — only a default-deny reason is a seed', (_case, operatorId, reason) => {
    expect(decideGoogleCapabilityPosture({ denied: true, operatorId, reason })).toBe(
      'kept_operator_denied',
    )
  })
})

const enabled = (generation = 1): AiControlHeadSnapshot => ({
  generation,
  executionState: 'enabled',
  admissionState: 'accepting',
})
const killed = (generation = 1): AiControlHeadSnapshot => ({
  generation,
  executionState: 'killed',
  admissionState: 'draining',
})

describe('decideAiCapabilityPosture', () => {
  it('enables a capability still in its seed state', () => {
    expect(
      decideAiCapabilityPosture({
        global: enabled(),
        provider: enabled(),
        capability: killed(1),
      }),
    ).toBe('enabled')
  })

  it('leaves an enabled capability alone', () => {
    expect(
      decideAiCapabilityPosture({
        global: enabled(),
        provider: enabled(),
        capability: enabled(2),
      }),
    ).toBe('already_enabled')
  })

  it('never overrides an operator kill (generation past the seed)', () => {
    expect(
      decideAiCapabilityPosture({
        global: enabled(),
        provider: enabled(),
        capability: killed(3),
      }),
    ).toBe('kept_operator_killed')
  })

  it('treats an operator drain as deliberate too', () => {
    expect(
      decideAiCapabilityPosture({
        global: enabled(),
        provider: enabled(),
        capability: {
          generation: 2,
          executionState: 'enabled',
          admissionState: 'draining',
        },
      }),
    ).toBe('kept_operator_killed')
  })

  it.each([
    ['the global plane is killed', { global: killed(2), provider: enabled() }],
    ['the provider profile is draining', { global: enabled(), provider: killed(2) }],
  ])('skips when %s — the activation function would refuse', (_case, plane) => {
    expect(decideAiCapabilityPosture({ ...plane, capability: killed(1) })).toBe(
      'skipped_plane_stopped',
    )
  })

  it.each([
    ['global', { global: undefined, provider: enabled() }],
    ['provider', { global: enabled(), provider: undefined }],
  ])('reports a missing %s head as absent, not as a stop', (_scope, plane) => {
    expect(decideAiCapabilityPosture({ ...plane, capability: killed(1) })).toBe(
      'skipped_head_absent',
    )
  })

  it('reports a missing capability head instead of guessing', () => {
    expect(
      decideAiCapabilityPosture({
        global: enabled(),
        provider: enabled(),
        capability: undefined,
      }),
    ).toBe('skipped_head_absent')
  })
})

describe('formatDeclaredCapabilityPostureReport', () => {
  it('says so in one line when nothing is declared', () => {
    expect(formatDeclaredCapabilityPostureReport({ google: [], ai: [] })).toBe(
      '[declared-posture] nothing declared (GOOGLE_CONTENT_CAPABILITIES_ALLOWED and AI_CAPABILITIES_ENABLED unset); controls left as they are',
    )
  })

  it('names what was lifted, what was left and why, in one line', () => {
    const line = formatDeclaredCapabilityPostureReport({
      google: [
        { capability: 'property.import_gbp_v2', outcome: 'lifted' },
        { capability: 'property.connect_gbp', outcome: 'lifted' },
        { capability: 'property.publish_reply', outcome: 'kept_operator_denied' },
        { capability: 'property.read_gbp_performance', outcome: 'already_allowed' },
      ],
      ai: [
        { capability: 'review_analysis', outcome: 'enabled' },
        { capability: 'reply_drafting', outcome: 'kept_operator_killed' },
      ],
    })
    expect(line).toBe(
      '[declared-posture] google lifted=[property.import_gbp_v2,property.connect_gbp] ' +
        'already_allowed=[property.read_gbp_performance] ' +
        'kept_operator_denied=[property.publish_reply]; ' +
        'ai enabled=[review_analysis] already_enabled=[] ' +
        'kept_operator_killed=[reply_drafting] skipped_plane_stopped=[] ' +
        'skipped_head_absent=[]',
    )
    expect(line.includes('\n')).toBe(false)
  })

  it('marks an undeclared side instead of printing empty groups', () => {
    expect(
      formatDeclaredCapabilityPostureReport({
        google: [{ capability: 'property.connect_gbp', outcome: 'already_allowed' }],
        ai: [],
      }),
    ).toBe(
      '[declared-posture] google lifted=[] already_allowed=[property.connect_gbp] ' +
        'kept_operator_denied=[]; ai not declared',
    )
  })
})
