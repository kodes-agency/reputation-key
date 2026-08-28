import { describe, expect, it } from 'vitest'
import {
  assertBetaFeedbackTriageTransition,
  type BetaFeedbackTriageSnapshot,
  type BetaFeedbackTriageTransition,
} from './betaFeedbackTriage'
import { isIdentityError } from './errors'

const current: BetaFeedbackTriageSnapshot = {
  reference: '00000000-0000-4000-8000-000000000001',
  deliveryState: 'delivered',
  triageState: 'new',
  severity: 'unclassified',
  privacyClass: 'pending',
  securityClass: 'pending',
  reproduction: 'pending',
  dedupeDisposition: 'pending',
  duplicateOfReference: null,
  ownerQueue: 'beta_support',
  ownerPseudonym: null,
  customerResponse: 'pending',
  engineeringIssueRef: null,
  revision: 1,
}

const screened: BetaFeedbackTriageTransition = {
  expectedRevision: 1,
  toState: 'screened',
  severity: 'P2',
  privacyClass: 'clear',
  securityClass: 'none',
  reproduction: 'pending',
  dedupeDisposition: 'pending',
  duplicateOfReference: null,
  ownerQueue: 'beta_support',
  ownerPseudonym: 'a'.repeat(64),
  customerResponse: 'pending',
  engineeringIssueRef: null,
  reasonCode: 'initial_screen',
  supportEvidenceRef: 'support:feedback:screen-1',
}

describe('beta feedback triage state', () => {
  it('requires classification and a named pseudonymous owner before screening', () => {
    expect(assertBetaFeedbackTriageTransition(current, screened)).toMatchObject({
      triageState: 'screened',
      revision: 2,
      ownerPseudonym: 'a'.repeat(64),
    })

    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        privacyClass: 'pending',
      }),
    ).toThrow('privacy and security classification')
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        ownerPseudonym: null,
      }),
    ).toThrow('named triage owner')
  })

  it('requires reproduction and dedupe decisions before acceptance', () => {
    const afterScreen = assertBetaFeedbackTriageTransition(current, screened)
    expect(() =>
      assertBetaFeedbackTriageTransition(afterScreen, {
        ...screened,
        expectedRevision: 2,
        toState: 'accepted',
      }),
    ).toThrow('reproduction and dedupe')

    expect(
      assertBetaFeedbackTriageTransition(afterScreen, {
        ...screened,
        expectedRevision: 2,
        toState: 'accepted',
        reproduction: 'reproduced',
        dedupeDisposition: 'unique',
        ownerQueue: 'engineering',
        engineeringIssueRef: 'github:rep-key:123',
      }),
    ).toMatchObject({ triageState: 'accepted', revision: 3 })
  })

  it('routes suspected security reports to the security queue', () => {
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        securityClass: 'suspected',
      }),
    ).toThrow('security queue')

    expect(
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        securityClass: 'suspected',
        ownerQueue: 'security',
      }),
    ).toMatchObject({ securityClass: 'suspected', ownerQueue: 'security' })
  })

  it('rejects stale revisions, invalid dedupe links, and unresolved customer response', () => {
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        expectedRevision: 0,
      }),
    ).toThrow('revision')
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        dedupeDisposition: 'duplicate',
        duplicateOfReference: current.reference,
      }),
    ).toThrow('different feedback reference')

    const accepted = {
      ...assertBetaFeedbackTriageTransition(current, screened),
      triageState: 'accepted' as const,
      reproduction: 'reproduced' as const,
      dedupeDisposition: 'unique' as const,
      revision: 5,
    }
    expect(() =>
      assertBetaFeedbackTriageTransition(accepted, {
        ...screened,
        expectedRevision: 5,
        toState: 'resolved',
        reproduction: 'reproduced',
        dedupeDisposition: 'unique',
      }),
    ).toThrow('customer response')
  })

  it('throws the context-tagged error shape for rejected business transitions', () => {
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        expectedRevision: 0,
      }),
    ).toThrow(
      expect.objectContaining({
        _tag: 'IdentityError',
        code: 'feedback_triage_invalid',
      }),
    )
    try {
      assertBetaFeedbackTriageTransition(current, { ...screened, expectedRevision: 0 })
    } catch (error) {
      expect(isIdentityError(error)).toBe(true)
    }
  })
})
