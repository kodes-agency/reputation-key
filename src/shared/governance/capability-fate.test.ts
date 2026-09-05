import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  // Issue #406: three source comments named the SEC-01 *finding* as
  // portal.upload's removal gate and listed its criteria — all of which are now
  // satisfied, since SEC-01 is closed. The real gate is the SAFE-01 *package*
  // completion record, which is still open on deployed evidence. A reader
  // following the old comments would have unblocked the capability.
  it('names the SAFE-01 package, not the closed SEC-01 finding, as the portal.upload gate', () => {
    expect(CAPABILITY_FATE['portal.upload'].activation).toContain('SAFE-01')

    for (const path of [
      'src/shared/auth/beta-capabilities.ts',
      'src/shared/auth/capability-for-permission.ts',
      'src/shared/config/local-stack-contract.ts',
    ]) {
      const text = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(text, `${path} must name the real gate`).toContain('SAFE-01')
      // SEC-01 may only appear as the closed finding it is, never as the gate.
      for (const claim of [
        'temporary SEC-01',
        'SEC-01 containment',
        'SEC-01 remediation lands',
      ]) {
        expect(text, `${path} still cites SEC-01 as the gate`).not.toContain(claim)
      }
    }
  })

  it('keeps runtime core and blocked posture aligned with the accepted fate', () => {
    for (const capability of listAllCapabilities()) {
      const record = CAPABILITY_FATE[capability]
      expect(isCoreCapability(capability), `${capability} core drift`).toBe(
        record.fate === 'core',
      )
      expect(isBlockedCapability(capability), `${capability} blocked drift`).toBe(
        ['beta_disabled', 'safety_blocked', 'permanently_denied'].includes(record.fate),
      )
    }
  })

  it('makes the settled high-risk decisions explicit', () => {
    // @proof GOAL_RECOGNITION_RUNTIME#1
    expect(listCapabilitiesByFate('permanently_denied')).toEqual([
      'gbp.ai.cross_property_summary',
      'gbp.reply.auto_publish',
      'gbp.review_solicitation_gamification',
    ])
    expect(CAPABILITY_FATE['portal.upload'].fate).toBe('safety_blocked')
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
