// Every persisted state/event pair is checked against independent rules
// written from the Review context, rather than the production transition table.

import { describe, it, expect } from 'vitest'
import {
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationStateEvent,
  type PublicationStateInput,
} from './reply-publication-workflow'

/** NULL is a reply with no publication workflow: a draft, or a legacy row. */
const PERSISTED_STATES: ReadonlyArray<PublicationStateInput> = [
  null,
  'requested',
  'authorized',
  'sending',
  'pending_observation',
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
]

const EVENTS: ReadonlyArray<PublicationStateEvent> = [
  'authorize',
  'claim',
  'provider_accepted',
  'publish',
  'fail_terminal',
  'fail_ambiguous',
  'requeue',
  'cancel',
]

/**
 * The persisted machine, one rule per event: the states the event applies
 * from, and the one state it leads to. Everywhere else the answer is null (no
 * write, no fact). Written by hand from the Review CONTEXT (Model, Runtime and
 * Invariants 7 to 9), and keyed by event where production is keyed by state,
 * so it is not a copy of the table it checks.
 */
const PERSISTED_RULES: Readonly<
  Record<
    PublicationStateEvent,
    Readonly<{
      from: ReadonlyArray<PublicationStateInput>
      to: PersistedPublicationState
    }>
  >
> = {
  // A new cycle starts only where nothing is in flight and nothing is unknown:
  // an approval (no workflow yet, or a cancelled one) or a retry of a settled
  // failure. `requested` is reserved; an approval writes `authorized` directly.
  authorize: { from: [null, 'requested', 'terminal', 'cancelled'], to: 'authorized' },
  // One authorization grants one claim.
  claim: { from: ['authorized'], to: 'sending' },
  // Only a write that was sent can have been accepted.
  provider_accepted: { from: ['sending'], to: 'pending_observation' },
  // Only an exact observation of the reply on Google publishes: after an
  // accepted write, or as the heal of a failed, uncertain or legacy row. Never
  // a cycle that was not sent, one still on the wire, or a cancelled one.
  publish: {
    from: [null, 'pending_observation', 'terminal', 'ambiguous'],
    to: 'published',
  },
  // An accepted write is never called a rejection; it can only become unknown.
  fail_terminal: {
    from: ['requested', 'authorized', 'sending', 'ambiguous'],
    to: 'terminal',
  },
  // Only a write that left, or was accepted, can be of unknown outcome.
  fail_ambiguous: { from: ['sending', 'pending_observation'], to: 'ambiguous' },
  // Only a claimed attempt that provably was not sent goes back to a worker.
  requeue: { from: ['sending'], to: 'authorized' },
  // A cancellation ends an open, unconfirmed cycle and nothing else. (The
  // stores close a failed or uncertain cycle that provider truth or a changed
  // Review overtook by guarded writes of their own, not through this event.)
  cancel: {
    from: ['requested', 'authorized', 'sending', 'pending_observation'],
    to: 'cancelled',
  },
}

const expectedNext = (
  state: PublicationStateInput,
  event: PublicationStateEvent,
): PersistedPublicationState | null => {
  const rule = PERSISTED_RULES[event]
  return rule.from.includes(state) ? rule.to : null
}

const PERSISTED_CELLS = PERSISTED_STATES.flatMap((state) =>
  EVENTS.map((event) => [state, event] as const),
)

describe('persisted publication machine against hand-written rules', () => {
  it('answers every state × event cell as the rule for that event says, and never throws', () => {
    expect(PERSISTED_CELLS).toHaveLength(72)
    for (const [state, event] of PERSISTED_CELLS) {
      // A throw here fails the test: the authority must be total.
      expect(nextPublicationState(state, event), `${event} from ${String(state)}`).toBe(
        expectedNext(state, event),
      )
    }
  })

  it('never hands a worker an attempt that may be on Google, by any event', () => {
    // `authorized` is the one state a worker claims from. A row whose write
    // may have landed (`ambiguous`), was accepted (`pending_observation`) or is
    // published must reach it by no event at all: that would be a second write.
    for (const state of ['ambiguous', 'pending_observation', 'published'] as const) {
      for (const event of EVENTS) {
        const next = nextPublicationState(state, event)
        expect(next, `${event} from ${state}`).not.toBe('authorized')
        expect(next, `${event} from ${state}`).not.toBe('sending')
      }
    }
  })

  it('publishes only what was sent: never a cycle still waiting, on the wire or cancelled', () => {
    for (const state of ['requested', 'authorized', 'sending', 'cancelled'] as const) {
      expect(nextPublicationState(state, 'publish'), state).toBeNull()
    }
  })

  it('lets nothing leave published', () => {
    for (const event of EVENTS) {
      expect(nextPublicationState('published', event), event).toBeNull()
    }
  })
})
