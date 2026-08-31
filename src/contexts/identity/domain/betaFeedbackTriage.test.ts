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

describe('beta feedback triage refusals', () => {
  it('refuses to triage feedback that was prepared but never delivered', () => {
    // Triage is a record about a report the team actually received. Triaging an
    // undelivered one would produce a decision about nothing.
    expect(() =>
      assertBetaFeedbackTriageTransition(
        { ...current, deliveryState: 'prepared' },
        screened,
      ),
    ).toThrow('Only delivered feedback can enter triage')
  })

  it('refuses a stale revision rather than overwriting a concurrent decision', () => {
    expect(() =>
      assertBetaFeedbackTriageTransition(current, { ...screened, expectedRevision: 7 }),
    ).toThrow('revision is stale')
  })

  it('refuses a duplicate that links to nothing, or to itself', () => {
    const asDuplicate = {
      ...screened,
      reproduction: 'not_reproduced' as const,
      dedupeDisposition: 'duplicate' as const,
    }
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...asDuplicate,
        duplicateOfReference: null,
      }),
    ).toThrow('must link a different feedback reference')
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...asDuplicate,
        duplicateOfReference: current.reference,
      }),
    ).toThrow('must link a different feedback reference')
  })

  it('refuses escalated privacy feedback parked in an ordinary support queue', () => {
    // An escalation that stays in the support queue is an escalation nobody
    // owns; the privacy and security queues are the ones that answer for it.
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        privacyClass: 'escalated',
        ownerQueue: 'beta_support',
      }),
    ).toThrow('requires the privacy or security queue')
  })

  it('refuses an engineering issue link before the report is accepted', () => {
    expect(() =>
      assertBetaFeedbackTriageTransition(current, {
        ...screened,
        engineeringIssueRef: 'ENG-1234',
      }),
    ).toThrow('only after acceptance')
  })
})
