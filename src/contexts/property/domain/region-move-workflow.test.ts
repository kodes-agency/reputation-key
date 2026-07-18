// BQC-4.5 — region move workflow state machine (ADR 0048). Unit tests.
//
// Proves: every legal transition, the notable illegal ones, the authority
// rule per state (exactly ONE authoritative cell at every state), terminal
// states, rollback paths, and the point-of-no-return rule (no failed after
// source_erased).

import { describe, it, expect } from 'vitest'
import { isPropertyError } from './errors'
import {
  MOVE_TRANSITIONS,
  assertValidMoveTransition,
  authoritativeCellFor,
  isTerminalMoveState,
  isValidMoveTransition,
  type RegionMoveState,
} from './region-move-workflow'

const ALL_STATES: ReadonlyArray<RegionMoveState> = [
  'requested',
  'writes_paused',
  'queues_drained',
  'data_copied',
  'verified',
  'target_activated',
  'source_erased',
  'completed',
  'failed',
  'rolling_back',
  'rolled_back',
]

describe('region-move-workflow (BQC-4.5)', () => {
  describe('MOVE_TRANSITIONS — the happy path is a strict sequence', () => {
    it.each([
      ['requested', 'writes_paused'],
      ['writes_paused', 'queues_drained'],
      ['queues_drained', 'data_copied'],
      ['data_copied', 'verified'],
      ['verified', 'target_activated'],
      ['target_activated', 'source_erased'],
      ['source_erased', 'completed'],
    ] as const)('%s → %s is legal', (from, to) => {
      expect(isValidMoveTransition(from, to)).toBe(true)
      expect(() => assertValidMoveTransition(from, to)).not.toThrow()
    })
  })

  describe('failure and rollback paths', () => {
    it.each([
      'requested',
      'writes_paused',
      'queues_drained',
      'data_copied',
      'verified',
      'target_activated',
    ] as const)('%s → failed is legal (failure allowed before erasure)', (from) => {
      expect(isValidMoveTransition(from, 'failed')).toBe(true)
    })

    it('failed → rolling_back → rolled_back is the only rollback path', () => {
      expect(isValidMoveTransition('failed', 'rolling_back')).toBe(true)
      expect(isValidMoveTransition('rolling_back', 'rolled_back')).toBe(true)
      expect(MOVE_TRANSITIONS.failed).toEqual(['rolling_back'])
      expect(MOVE_TRANSITIONS.rolling_back).toEqual(['rolled_back'])
    })

    it('source_erased → failed is ILLEGAL (point of no return)', () => {
      expect(isValidMoveTransition('source_erased', 'failed')).toBe(false)
      expect(MOVE_TRANSITIONS.source_erased).not.toContain('failed')
      expect(MOVE_TRANSITIONS.source_erased).toEqual(['completed'])
    })
  })

  describe('illegal transitions throw invalid_transition', () => {
    it.each([
      // skipping steps on the happy path
      ['requested', 'completed'],
      ['requested', 'queues_drained'],
      ['writes_paused', 'data_copied'],
      ['verified', 'source_erased'],
      // backwards
      ['queues_drained', 'writes_paused'],
      ['completed', 'requested'],
      // terminal states have no exits
      ['completed', 'failed'],
      ['rolled_back', 'requested'],
      ['rolled_back', 'failed'],
      // rollback cannot complete the move
      ['failed', 'completed'],
      ['rolling_back', 'completed'],
      // self-transitions are not machine transitions (the stepper treats
      // same-state as an idempotent no-op BEFORE consulting the table)
      ['requested', 'requested'],
      ['completed', 'completed'],
    ] as const)('%s → %s throws invalid_transition', (from, to) => {
      expect(isValidMoveTransition(from, to)).toBe(false)
      expect(() => assertValidMoveTransition(from, to)).toThrowError(
        expect.objectContaining({
          _tag: 'PropertyError',
          code: 'invalid_transition',
        }) as unknown as Error,
      )
      try {
        assertValidMoveTransition(from, to)
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(isPropertyError(e)).toBe(true)
      }
    })
  })

  describe('terminal states', () => {
    it('completed and rolled_back are the only terminal states', () => {
      for (const state of ALL_STATES) {
        expect(isTerminalMoveState(state)).toBe(
          state === 'completed' || state === 'rolled_back',
        )
      }
    })
  })

  describe('authoritativeCellFor — exactly ONE authoritative cell per state', () => {
    const FROM = 'us'
    const TO = 'europe'

    it.each([
      'requested',
      'writes_paused',
      'queues_drained',
      'data_copied',
      'verified',
    ] as const)('%s → the SOURCE cell is authoritative (pre-activation)', (state) => {
      expect(authoritativeCellFor(state, FROM, TO)).toBe(FROM)
    })

    it.each(['target_activated', 'source_erased', 'completed'] as const)(
      '%s → the TARGET cell is authoritative (at/after activation)',
      (state) => {
        expect(authoritativeCellFor(state, FROM, TO)).toBe(TO)
      },
    )

    it.each(['failed', 'rolling_back', 'rolled_back'] as const)(
      '%s → the SOURCE cell is authoritative (rollback restores the source)',
      (state) => {
        expect(authoritativeCellFor(state, FROM, TO)).toBe(FROM)
      },
    )

    it('every state resolves to exactly one of the two cells — never both, never neither', () => {
      for (const state of ALL_STATES) {
        const authoritative = authoritativeCellFor(state, FROM, TO)
        expect([FROM, TO]).toContain(authoritative)
      }
    })
  })
})
