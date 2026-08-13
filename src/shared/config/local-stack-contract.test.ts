import { describe, expect, it } from 'vitest'
import {
  LOCAL_BETA_CAPABILITIES,
  LOCAL_E2E_BOOTSTRAP_CAPABILITIES,
  localStackEnvironment,
} from './local-stack-contract'

describe('local beta stack contract', () => {
  it('allows the promoted cohort surfaces without enabling prohibited Google behaviors', () => {
    expect(LOCAL_BETA_CAPABILITIES).toEqual(
      expect.arrayContaining([
        'portal.read',
        'portal.write',
        'portal.upload',
        'portal.public_read',
        'portal.guest_response',
        'portal.guest_text',
        'portal.guest_contact',
        'portal.guest_media',
        'team.use',
        'goal.use',
        'badge.use',
        'leaderboard.use',
        'notification.send_email',
      ]),
    )
    expect(LOCAL_BETA_CAPABILITIES).not.toEqual(
      expect.arrayContaining([
        'gbp.reply.auto_publish',
        'gbp.ai.cross_property_summary',
        'gbp.review_solicitation_gamification',
      ]),
    )
  })

  it('limits the permissive E2E override to account bootstrap', () => {
    expect(localStackEnvironment('beta')).toMatchObject({
      E2E_WEB_CAPABILITY_OVERRIDE: '',
      E2E_WEB_EXECUTION_IDENTITY: '',
    })
    expect(localStackEnvironment('perf')).toMatchObject({
      E2E_WEB_CAPABILITY_OVERRIDE: '',
      E2E_WEB_EXECUTION_IDENTITY: '',
    })
    expect(LOCAL_E2E_BOOTSTRAP_CAPABILITIES).toEqual([
      'identity.register',
      'organization.create',
    ])
    expect(localStackEnvironment('e2e')).toMatchObject({
      E2E_WEB_CAPABILITY_OVERRIDE: LOCAL_E2E_BOOTSTRAP_CAPABILITIES.join(','),
      E2E_WEB_EXECUTION_IDENTITY: 'local-playwright-e2e',
    })
  })
})
