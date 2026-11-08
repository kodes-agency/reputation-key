import { describe, expect, it } from 'vitest'
import { parseAiControlArgs } from './ai-execution-control'

const PROFILE = 'private-beta-global-v3'
const RELEASE = 'a'.repeat(40)

describe('AI operator controls', () => {
  it.each(['inspect', 'kill', 'drain', 'restore'])(
    'accepts %s for all AI calls',
    (action) => {
      expect(
        parseAiControlArgs([
          action,
          'global',
          '--operator',
          'user:operator',
          '--reason',
          'incident',
          '--ticket',
          'INC-1',
          '--apply',
          '--yes',
          'ops:ai-control',
        ]),
      ).toEqual({
        action,
        scope: { kind: 'global' },
        scopeKey: 'global',
        providerDeploymentProfileVersion: null,
        candidateReleaseSha: null,
      })
    },
  )

  it.each(
    ['kill', 'drain'].flatMap((action) =>
      [
        ['provider', PROFILE],
        ['capability', 'review_analysis', PROFILE],
        ['capability', 'reply_drafting', PROFILE],
        ['capability', 'property_trends', PROFILE],
      ].map((scope) => [action, ...scope]),
    ),
  )('refuses a scoped stop %j before opening the database', (...argv) => {
    expect(parseAiControlArgs(argv)).toBeNull()
  })

  it.each(['inspect', 'restore'])(
    'keeps %s for persisted provider controls',
    (action) => {
      expect(parseAiControlArgs([action, 'provider', PROFILE])).toEqual({
        action,
        scope: {
          kind: 'provider_deployment_profile',
          providerDeploymentProfileVersion: PROFILE,
        },
        scopeKey: `provider:${PROFILE}`,
        providerDeploymentProfileVersion: PROFILE,
        candidateReleaseSha: null,
      })
    },
  )

  it.each(['review_analysis', 'reply_drafting', 'property_trends'])(
    'keeps inspection and release-bound recovery for persisted %s controls',
    (capability) => {
      const scope = { kind: 'capability', capability }
      expect(parseAiControlArgs(['inspect', 'capability', capability, PROFILE])).toEqual({
        action: 'inspect',
        scope,
        scopeKey: `capability:${capability}`,
        providerDeploymentProfileVersion: PROFILE,
        candidateReleaseSha: null,
      })
      expect(
        parseAiControlArgs(['restore', 'capability', capability, PROFILE, RELEASE]),
      ).toEqual({
        action: 'restore',
        scope,
        scopeKey: `capability:${capability}`,
        providerDeploymentProfileVersion: PROFILE,
        candidateReleaseSha: RELEASE,
      })
    },
  )

  it.each([
    [],
    ['kill'],
    ['enable', 'global'],
    ['inspect', 'unknown'],
    ['inspect', 'global', 'extra'],
    ['kill', 'global', 'extra'],
    ['inspect', 'provider'],
    ['inspect', 'provider', '../profile'],
    ['inspect', 'provider', PROFILE, 'extra'],
    ['restore', 'provider'],
    ['restore', 'provider', '../profile'],
    ['restore', 'provider', PROFILE, RELEASE],
    ['inspect', 'capability', 'unknown', PROFILE],
    ['inspect', 'capability', 'review_analysis'],
    ['inspect', 'capability', 'review_analysis', '../profile'],
    ['restore', 'capability', 'unknown', PROFILE, RELEASE],
    ['restore', 'capability', 'review_analysis', '../profile', RELEASE],
    ['restore', 'capability', 'review_analysis', PROFILE],
    ['restore', 'capability', 'review_analysis', PROFILE, 'bad-release'],
    ['restore', 'capability', 'review_analysis', PROFILE, RELEASE, 'extra'],
    ['inspect', 'capability', 'review_analysis', PROFILE, RELEASE],
  ])('refuses malformed arguments %j', (...argv) => {
    expect(parseAiControlArgs(argv)).toBeNull()
  })
})
