import { describe, expect, it } from 'vitest'
import {
  isBlockedCapability,
  isCoreCapability,
  listAllCapabilities,
} from '#/shared/auth/beta-capabilities'
import { CAPABILITY_FATE, listCapabilitiesByFate } from './capability-fate'

describe('accepted beta capability fate authority', () => {
  it('classifies the complete runtime capability vocabulary exactly once', () => {
    expect(Object.keys(CAPABILITY_FATE).sort()).toEqual([...listAllCapabilities()])
  })

  it('keeps runtime core and blocked posture aligned with the accepted fate', () => {
    for (const capability of listAllCapabilities()) {
      const record = CAPABILITY_FATE[capability]
      expect(isCoreCapability(capability), `${capability} core drift`).toBe(
        record.fate === 'core',
      )
      expect(isBlockedCapability(capability), `${capability} blocked drift`).toBe(
        [
          'beta_disabled',
          'safety_blocked',
          'legacy_blocked',
          'permanently_denied',
        ].includes(record.fate),
      )
    }
  })

  it('makes the settled high-risk decisions explicit', () => {
    expect(listCapabilitiesByFate('legacy_blocked')).toEqual([
      'badge.use',
      'leaderboard.use',
    ])
    expect(listCapabilitiesByFate('permanently_denied')).toEqual([
      'gbp.ai.cross_property_summary',
      'gbp.reply.auto_publish',
      'gbp.review_solicitation_gamification',
    ])
    expect(CAPABILITY_FATE['portal.upload'].fate).toBe('safety_blocked')
    expect(CAPABILITY_FATE['portal.guest_contact'].fate).toBe('safety_blocked')
    expect(CAPABILITY_FATE['portal.guest_media'].fate).toBe('beta_disabled')
    expect(CAPABILITY_FATE['team.use'].fate).toBe('beta_disabled')
  })

  it('keeps each independently authorized AI operation controlled and opt-in', () => {
    expect(CAPABILITY_FATE['ai.analyze'].fate).toBe('controlled_beta')
    expect(CAPABILITY_FATE['ai.generate_reply'].fate).toBe('controlled_beta')
    expect(CAPABILITY_FATE['ai.detect_trends'].fate).toBe('controlled_beta')
  })
})
