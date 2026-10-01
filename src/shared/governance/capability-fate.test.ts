import { describe, expect, it } from 'vitest'
import { listAllCapabilities } from '#/shared/auth/beta-capabilities'
import { CAPABILITY_FATE, listCapabilitiesByFate } from './capability-fate'

describe('accepted beta capability fate authority', () => {
  it('classifies the complete runtime capability vocabulary exactly once', () => {
    expect(Object.keys(CAPABILITY_FATE).sort()).toEqual([...listAllCapabilities()])
  })

  it('opens portal.upload as controlled beta, with the removed SAFE-01 ceremony and the kept safeguards on record', () => {
    // The owner removed the SAFE-01 completion ceremony on 2026-09-30 (ADR 0063).
    // The fate is no longer a block, but it is not core either: tenant policy still
    // decides who may upload, and the record says what stayed in the build.
    expect(CAPABILITY_FATE['portal.upload']).toMatchObject({
      fate: 'controlled_beta',
      authority: expect.stringMatching(/removed the SAFE-01.*2026-09-30/u),
      activation: CAPABILITY_FATE['portal.write'].activation,
    })
    expect(CAPABILITY_FATE['portal.upload'].authority).toContain('re-encoding')
    expect(CAPABILITY_FATE['portal.upload'].authority).toContain('same-origin')
  })

  it('makes the settled high-risk decisions explicit', () => {
    // @proof GOAL_RECOGNITION_RUNTIME#1
    expect(listCapabilitiesByFate('permanently_denied')).toEqual([
      'gbp.ai.cross_property_summary',
      'gbp.reply.auto_publish',
      'gbp.review_solicitation_gamification',
    ])
    expect(CAPABILITY_FATE['portal.guest_contact'].fate).toBe('safety_blocked')
    expect(CAPABILITY_FATE['portal.guest_media'].fate).toBe('beta_disabled')
    expect(CAPABILITY_FATE['identity.custom_roles'].fate).toBe('beta_disabled')
  })

  it('keeps each independently authorized AI operation controlled and opt-in', () => {
    expect(CAPABILITY_FATE['ai.analyze'].fate).toBe('controlled_beta')
    expect(CAPABILITY_FATE['ai.generate_reply'].fate).toBe('controlled_beta')
    expect(CAPABILITY_FATE['ai.detect_trends'].fate).toBe('controlled_beta')
  })
})
