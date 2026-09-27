// The AI settings route owns the enable / change / turn-off Actions: it builds
// them with useActionMutation and hands them down. The component used to keep a
// pending flag of its own beside them, so a command the route reported in flight
// left the consent controls live. These render the section with one Action in
// flight and read the controls' disabled state from the server markup.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { MerchantAiSnapshot } from '#/contexts/identity/application/public-api'
import {
  MerchantAiPropertyAuthorization,
  type MerchantAiPropertyAuthorizationProps,
} from './merchant-ai-property-authorization'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'

const enabled: MerchantAiSnapshot = {
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  state: 'enabled',
  authorizationLineageId: '20000000-0000-4000-8000-000000000001',
  capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
  capabilityRuntimeProfileVersions: {
    review_analysis: 'review-analysis-runtime-v1',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  },
  capabilityEpochs: { review_analysis: 1, reply_drafting: 1, property_trends: 1 },
  authorizedSourceEpoch: 7,
  analysisStartSequence: 0,
  stateVersion: 1,
  noticeVersion: MERCHANT_AI_NOTICE.version,
  noticeDigest: MERCHANT_AI_NOTICE.digest,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  processingRegion: 'global',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'gbp-review-global-v1',
}

function action<TInput>(isPending: boolean): Action<TInput, MerchantAiSnapshot> {
  return Object.assign(async (_input: TInput) => enabled, {
    isPending,
    error: null,
    isSuccess: false,
    data: null,
  })
}

function render(
  inFlight: Partial<Record<'enable' | 'change' | 'revoke', boolean>>,
): string {
  const props: MerchantAiPropertyAuthorizationProps = {
    property: { id: PROPERTY_ID, name: 'Harbor & Pine', googleBindingState: 'active' },
    snapshot: enabled,
    notice: MERCHANT_AI_NOTICE,
    enable: action(inFlight.enable ?? false),
    change: action(inFlight.change ?? false),
    revoke: action(inFlight.revoke ?? false),
  }
  return renderToStaticMarkup(createElement(MerchantAiPropertyAuthorization, props))
}

/** The opening tag of the one element carrying `marker`. */
function openingTag(markup: string, marker: string): string {
  const at = markup.indexOf(marker)
  if (at === -1) throw new Error(`no element carries ${marker}`)
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1)
}

const acknowledgement = (markup: string) =>
  openingTag(markup, 'id="merchant-ai-acknowledgement"')
const turnOff = (markup: string) => {
  const at = markup.indexOf('>Turn off AI features</button>')
  if (at === -1) throw new Error('no Turn off AI features button')
  return markup.slice(markup.lastIndexOf('<button', at), at + 1)
}

describe('MerchantAiPropertyAuthorization pending state', () => {
  it('leaves the controls live while no command is in flight', () => {
    const markup = render({})

    expect(acknowledgement(markup)).not.toContain('disabled=""')
    expect(turnOff(markup)).not.toContain('disabled=""')
  })

  it.each(['enable', 'change', 'revoke'] as const)(
    'locks the consent and turn-off controls while the route reports %s in flight',
    (command) => {
      const markup = render({ [command]: true })

      expect(acknowledgement(markup)).toContain('disabled=""')
      expect(turnOff(markup)).toContain('disabled=""')
    },
  )
})
