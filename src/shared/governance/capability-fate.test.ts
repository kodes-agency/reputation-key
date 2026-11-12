import { describe, expect, it } from 'vitest'
import { listAllCapabilities } from '#/shared/auth/beta-capabilities'
import { CAPABILITY_FATE, listCapabilitiesByFate } from './capability-fate'

describe('accepted beta capability fate authority', () => {
  it('classifies the complete runtime capability vocabulary exactly once', () => {
    expect(Object.keys(CAPABILITY_FATE).sort()).toEqual([...listAllCapabilities()])
  })

  it('opens portal.upload, with the removed SAFE-01 ceremony and the kept safeguards on record', () => {
    // The owner removed the SAFE-01 completion ceremony on 2026-09-30 (ADR 0063).
    // The fate is no longer a block, and the record says what stayed in the build.
    expect(CAPABILITY_FATE['portal.upload']).toMatchObject({
      fate: 'core',
      featureSwitch: null,
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

  it('puts each AI operation under the AI switch; consent still decides per Property', () => {
    expect(CAPABILITY_FATE['ai.analyze']).toMatchObject({
      fate: 'core',
      featureSwitch: 'ai',
    })
    expect(CAPABILITY_FATE['ai.generate_reply']).toMatchObject({
      fate: 'core',
      featureSwitch: 'ai',
    })
    expect(CAPABILITY_FATE['ai.detect_trends'].fate).toBe('beta_disabled')
  })
})

describe('staff account activation', () => {
  it('is on for every Organization while targets keep their separate switch', () => {
    expect(CAPABILITY_FATE['staff.accounts']).toMatchObject({
      fate: 'core',
      featureSwitch: null,
    })
    expect(CAPABILITY_FATE['staff.accounts'].authority).toContain(
      'STAFF_SCAN_TARGETS_ENABLED',
    )
    expect(listCapabilitiesByFate('core')).toHaveLength(27)
    expect(listCapabilitiesByFate('beta_disabled')).toHaveLength(6)
  })
})
