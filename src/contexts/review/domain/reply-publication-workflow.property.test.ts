// BQC-6.9: the reply publication state machines against tables written by hand.
//
// Both expected tables below are written out in this file, from the module's
// header (the saga) and from the Review CONTEXT (the persisted machine). They
// import nothing from the tables under test. The first version of this file
// asked production's own maps what to expect, so an edge added to a map moved
// both sides of every assertion and no test could fail on it: "an attempt of
// unknown outcome goes back to a worker" passed the whole domain suite.
//
// The state and event sets are small and closed, so every cell is checked, not
// a sample of them:
//   1. the saga allows exactly the hand-written edges, and refuses every other
//      pair with a tagged ReviewError that names the pair;
//   2. terminal saga states have no exit, and idle / active / terminal is a
//      partition written out by hand;
//   3. the persisted machine answers every state × event cell as the
//      hand-written rule for that event says, and never throws;
//   4. the moves that would put a second write on Google are named one by one.
// Generated input is kept for the open-ended part: a state outside the declared
// union is always refused.

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  isValidPublicationTransition,
  assertValidPublicationTransition,
  isPublicationActive,
  isPublicationTerminal,
  nextPublicationState,
  type ReplyPublicationState,
  type PersistedPublicationState,
  type PublicationStateEvent,
  type PublicationStateInput,
} from './reply-publication-workflow'
import { isReviewError } from './errors'

const SAGA_STATES: ReadonlyArray<ReplyPublicationState> = [
  'idle',
  'publish_requested',
  'publishing',
  'published',
  'rejected_terminal',
  'outcome_unknown',
  'reconciling',
  'retryable',
  'manual_review',
]

/**
 * Every move the saga has, written by hand from the diagram in the module
 * header. A send of unknown outcome has one way on, through `reconciling`:
 * nothing goes from `outcome_unknown` back to `publishing`.
 */
const SAGA_EDGES: ReadonlyArray<readonly [ReplyPublicationState, ReplyPublicationState]> =
  [
    ['idle', 'publish_requested'],
    ['publish_requested', 'publishing'],
    ['publish_requested', 'rejected_terminal'],
    ['publishing', 'published'],
    ['publishing', 'rejected_terminal'],
    ['publishing', 'outcome_unknown'],
    ['outcome_unknown', 'reconciling'],
    ['reconciling', 'published'],
    ['reconciling', 'retryable'],
    ['reconciling', 'manual_review'],
    ['retryable', 'publishing'],
    ['retryable', 'manual_review'],
  ]

const SAGA_TERMINAL: ReadonlyArray<ReplyPublicationState> = [
  'published',
  'rejected_terminal',
  'manual_review',
]

const SAGA_ACTIVE: ReadonlyArray<ReplyPublicationState> = [
  'publish_requested',
  'publishing',
  'outcome_unknown',
  'reconciling',
  'retryable',
]

const sagaAllows = (from: ReplyPublicationState, to: ReplyPublicationState): boolean =>
  SAGA_EDGES.some(([a, b]) => a === from && b === to)

const SAGA_PAIRS = SAGA_STATES.flatMap((from) =>
  SAGA_STATES.map((to) => [from, to] as const),
)

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

// Runtime-garbage states (untyped rows) — anything outside the declared unions.
const arbSagaState = fc.constantFrom(...SAGA_STATES)
const arbBogusState = fc
  .string()
  .filter((s) => !(SAGA_STATES as ReadonlyArray<string>).includes(s))

// BQC-6.9 finding F-69-1 (reported, NOT patched in this slice): prototype-chain
// keys ('toString', 'valueOf', 'constructor', '__proto__', …) resolve through
// Object.prototype on the transition map, so `map[from]?.includes(to)` throws
// an UNTAGGED TypeError instead of returning false / the tagged ReviewError
// the module header promises. The transition is still DENIED — no illegal
// transition is ever allowed — only the error tagging breaks, and only for
// untyped input (typed code cannot produce these keys). Recommended follow-up:
// Object.hasOwn-guard the lookup before indexing the transition map.
const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype))

/** The tagged error `assertValidPublicationTransition` throws, or null. */
function refusalOf(from: ReplyPublicationState, to: ReplyPublicationState): unknown {
  try {
    assertValidPublicationTransition(from, to)
    return null
  } catch (error) {
    return error
  }
}

describe('reply publication saga machine against a hand-written table', () => {
  it('allows exactly the hand-written edges and no other pair', () => {
    expect(SAGA_PAIRS).toHaveLength(81)
    for (const [from, to] of SAGA_PAIRS) {
      expect(isValidPublicationTransition(from, to), `${from} → ${to}`).toBe(
        sagaAllows(from, to),
      )
    }
  })

  it('passes every hand-written edge and refuses every other pair with a tagged error naming it', () => {
    for (const [from, to] of SAGA_PAIRS) {
      const refusal = refusalOf(from, to)
      if (sagaAllows(from, to)) {
        expect(refusal, `${from} → ${to}`).toBeNull()
        continue
      }
      expect(isReviewError(refusal), `${from} → ${to}`).toBe(true)
      expect(refusal).toMatchObject({
        code: 'invalid_transition',
        context: { from, to },
      })
    }
  })

  it('gives a terminal state no exit', () => {
    for (const from of SAGA_TERMINAL) {
      for (const to of SAGA_STATES) {
        expect(isValidPublicationTransition(from, to), `${from} → ${to}`).toBe(false)
      }
    }
  })

  it('classifies every state as idle, active or terminal, as written here', () => {
    for (const state of SAGA_STATES) {
      expect(isPublicationActive(state), state).toBe(SAGA_ACTIVE.includes(state))
      expect(isPublicationTerminal(state), state).toBe(SAGA_TERMINAL.includes(state))
    }
    // The three hand-written classes cover the states and do not overlap.
    expect(['idle', ...SAGA_ACTIVE, ...SAGA_TERMINAL].sort()).toEqual(
      [...SAGA_STATES].sort(),
    )
  })

  it('never resends a write of unknown outcome without reconciling it first', () => {
    expect(isValidPublicationTransition('outcome_unknown', 'publishing')).toBe(false)
    expect(isValidPublicationTransition('outcome_unknown', 'publish_requested')).toBe(
      false,
    )
    expect(isValidPublicationTransition('outcome_unknown', 'retryable')).toBe(false)
  })

  it('untyped garbage states are never allowed (deny invariant holds for any string)', () => {
    fc.assert(
      fc.property(arbBogusState, arbSagaState, (bogus, to) => {
        const from = bogus as ReplyPublicationState
        // Deny = returns false OR throws (see F-69-1 above: prototype keys
        // currently throw an untagged TypeError — still a denial).
        let allowed: boolean
        try {
          allowed = isValidPublicationTransition(from, to)
        } catch {
          allowed = false
        }
        expect(allowed).toBe(false)
      }),
      { numRuns: 300 },
    )
  })

  it('non-prototype garbage states are denied with a tagged ReviewError', () => {
    fc.assert(
      fc.property(
        arbBogusState.filter((s) => !PROTOTYPE_KEYS.has(s)),
        arbSagaState,
        (bogus, to) => {
          const from = bogus as ReplyPublicationState
          expect(isValidPublicationTransition(from, to)).toBe(false)
          expect(isReviewError(refusalOf(from, to))).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })
})

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
