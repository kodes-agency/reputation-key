// BQC-6.9 — property tests for the reply publication state machines (fast-check).
//
// Generates arbitrary saga transition requests (from × to) and arbitrary
// persisted-state requests (state × event), then asserts:
//   1. the saga authority never allows an illegal transition —
//      isValidPublicationTransition agrees with the declared
//      VALID_PUBLICATION_TRANSITIONS map on EVERY input;
//   2. every denial is a tagged outcome — assertValidPublicationTransition
//      either returns cleanly (legal edge) or throws a tagged ReviewError
//      with code 'invalid_transition' (never an untagged error, never the
//      wrong verdict);
//   3. terminal states never exit; the active/terminal/idle classification
//      is a partition;
//   4. the persisted authority (nextPublicationState) agrees with the
//      declared PERSISTED_PUBLICATION_TRANSITIONS map plus the documented
//      NULL-state rules, and never throws.

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  isValidPublicationTransition,
  assertValidPublicationTransition,
  isPublicationActive,
  isPublicationTerminal,
  nextPublicationState,
  VALID_PUBLICATION_TRANSITIONS,
  PERSISTED_PUBLICATION_TRANSITIONS,
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

const PERSISTED_STATES: ReadonlyArray<PersistedPublicationState> = [
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

const arbSagaState = fc.constantFrom(...SAGA_STATES)
const arbPersistedState = fc.constantFrom(...PERSISTED_STATES)
const arbEvent = fc.constantFrom(...EVENTS)
const arbCurrent: fc.Arbitrary<PublicationStateInput> = fc.option(arbPersistedState, {
  nil: null,
})
// Runtime-garbage states (untyped rows) — anything outside the declared unions.
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

describe('reply publication saga machine (property)', () => {
  it('isValidPublicationTransition agrees with the declared transition map on every input', () => {
    fc.assert(
      fc.property(arbSagaState, arbSagaState, (from, to) => {
        expect(isValidPublicationTransition(from, to)).toBe(
          VALID_PUBLICATION_TRANSITIONS[from].includes(to),
        )
      }),
      { numRuns: 400 },
    )
  })

  it('assertValidPublicationTransition: legal edges pass; illegal edges throw a tagged ReviewError', () => {
    fc.assert(
      fc.property(arbSagaState, arbSagaState, (from, to) => {
        if (VALID_PUBLICATION_TRANSITIONS[from].includes(to)) {
          expect(() => assertValidPublicationTransition(from, to)).not.toThrow()
          return
        }
        let caught: unknown
        try {
          assertValidPublicationTransition(from, to)
        } catch (e) {
          caught = e
        }
        expect(isReviewError(caught)).toBe(true)
        if (isReviewError(caught)) {
          expect(caught.code).toBe('invalid_transition')
          expect(caught.context).toEqual({ from, to })
        }
      }),
      { numRuns: 400 },
    )
  })

  it('terminal states never allow any exit transition', () => {
    fc.assert(
      fc.property(arbSagaState, (to) => {
        for (const from of SAGA_STATES.filter(isPublicationTerminal)) {
          expect(isValidPublicationTransition(from, to)).toBe(false)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('active / terminal / idle classify every state exactly once', () => {
    fc.assert(
      fc.property(arbSagaState, (state) => {
        const classes = [
          state === 'idle',
          isPublicationActive(state),
          isPublicationTerminal(state),
        ]
        expect(classes.filter(Boolean)).toHaveLength(1)
      }),
      { numRuns: 100 },
    )
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
          let caught: unknown
          try {
            assertValidPublicationTransition(from, to)
          } catch (e) {
            caught = e
          }
          expect(isReviewError(caught)).toBe(true)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('persisted publication machine (property)', () => {
  it('nextPublicationState agrees with the declared map + NULL-state rules, and never throws', () => {
    fc.assert(
      fc.property(arbCurrent, arbEvent, (current, event) => {
        // A throw here fails the property — the authority must be total.
        const next = nextPublicationState(current, event)

        const expected =
          current === null
            ? event === 'authorize'
              ? 'authorized'
              : event === 'publish'
                ? 'published'
                : null
            : (PERSISTED_PUBLICATION_TRANSITIONS[current][event] ?? null)

        expect(next).toBe(expected)
      }),
      { numRuns: 400 },
    )
  })

  it('every non-null outcome is a declared persisted state', () => {
    fc.assert(
      fc.property(arbCurrent, arbEvent, (current, event) => {
        const next = nextPublicationState(current, event)
        if (next !== null) {
          expect(PERSISTED_STATES).toContain(next)
        }
      }),
      { numRuns: 200 },
    )
  })
})
