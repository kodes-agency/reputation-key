import { describe, expect, it } from 'vitest'
import {
  GATE_POLICY,
  armedGates,
  dormantGates,
  gateById,
  isGateArmed,
  keptArmedByChoice,
  validateGatePolicy,
  type GateRecord,
} from './gate-policy'

const record = (overrides: Partial<GateRecord> = {}): GateRecord => ({
  id: 'example:gate',
  question: 'Does the example hold?',
  location: 'scripts/example.ts:1',
  surface: 'ci:check',
  classification: 'correctness',
  armedFrom: 'closed-beta',
  rationale: 'An example.',
  ...overrides,
})

describe('gate policy registry', () => {
  describe('the rule of this effort, machine-checked', () => {
    it('rejects a correctness gate that goes dormant at any posture', () => {
      // THE invariant. "A bug is still a bug with an audience of one" is the
      // rule the whole posture model rests on; without this check it is a
      // convention, and a convention is what gets quietly broken at 2am.
      const violations = validateGatePolicy([
        record({ id: 'a', classification: 'correctness', armedFrom: 'open-beta' }),
      ])

      expect(violations).toEqual([
        {
          gateId: 'a',
          reason: 'correctness gate must be armed at every posture',
        },
      ])
    })

    it('accepts a correctness gate armed from the narrowest posture', () => {
      expect(
        validateGatePolicy([
          record({ classification: 'correctness', armedFrom: 'closed-beta' }),
        ]),
      ).toEqual([])
    })

    it('lets an audience-dependent gate arm at any posture', () => {
      // Including the narrowest: keeping one armed by choice is allowed, it is
      // just visible (see keptArmedByChoice) rather than silent.
      for (const armedFrom of ['closed-beta', 'open-beta', 'ga'] as const) {
        expect(
          validateGatePolicy([
            record({ classification: 'audience-dependent', armedFrom }),
          ]),
        ).toEqual([])
      }
    })
  })

  describe('structural integrity', () => {
    it('rejects duplicate gate ids', () => {
      const violations = validateGatePolicy([
        record({ id: 'dup' }),
        record({ id: 'dup' }),
      ])

      expect(violations).toEqual([{ gateId: 'dup', reason: 'duplicate gate id' }])
    })

    it('rejects a gate with no rationale', () => {
      const violations = validateGatePolicy([record({ id: 'b', rationale: '   ' })])

      expect(violations).toEqual([
        { gateId: 'b', reason: 'rationale must explain the classification' },
      ])
    })

    it('reports every violation rather than stopping at the first', () => {
      const violations = validateGatePolicy([
        record({ id: 'x', classification: 'correctness', armedFrom: 'ga' }),
        record({ id: 'y', rationale: '' }),
      ])

      expect(violations).toHaveLength(2)
    })
  })

  describe('arming', () => {
    it('arms a gate once the audience reaches its threshold', () => {
      const gate = record({
        classification: 'audience-dependent',
        armedFrom: 'open-beta',
      })

      expect(isGateArmed(gate, 'closed-beta')).toBe(false)
      expect(isGateArmed(gate, 'open-beta')).toBe(true)
      expect(isGateArmed(gate, 'ga')).toBe(true)
    })

    it('re-arms without anyone remembering to, which is the entire point', () => {
      // The failure this prevents: a gate switched off "just for the beta" and
      // never switched back on. Widening the posture is the only action needed.
      const gates = [
        record({
          id: 'dormant',
          classification: 'audience-dependent',
          armedFrom: 'open-beta',
        }),
      ]

      expect(dormantGates('closed-beta', gates)).toHaveLength(1)
      expect(dormantGates('open-beta', gates)).toHaveLength(0)
      expect(armedGates('open-beta', gates)).toHaveLength(1)
    })

    it('separates armed from dormant with no gate in neither or both', () => {
      const gates = [
        record({ id: 'a', armedFrom: 'closed-beta' }),
        record({ id: 'b', classification: 'audience-dependent', armedFrom: 'open-beta' }),
        record({ id: 'c', classification: 'audience-dependent', armedFrom: 'ga' }),
      ]

      for (const posture of ['closed-beta', 'open-beta', 'ga'] as const) {
        expect(
          armedGates(posture, gates).length + dormantGates(posture, gates).length,
        ).toBe(gates.length)
      }
    })

    it('names the audience-dependent gates kept armed by choice', () => {
      const gates = [
        record({
          id: 'kept',
          classification: 'audience-dependent',
          armedFrom: 'closed-beta',
        }),
        record({
          id: 'off',
          classification: 'audience-dependent',
          armedFrom: 'open-beta',
        }),
        record({
          id: 'correct',
          classification: 'correctness',
          armedFrom: 'closed-beta',
        }),
      ]

      expect(keptArmedByChoice('closed-beta', gates).map((gate) => gate.id)).toEqual([
        'kept',
      ])
    })
  })

  describe('lookup', () => {
    it('finds a gate by id', () => {
      const gates = [record({ id: 'wanted' }), record({ id: 'other' })]

      expect(gateById('wanted', gates)?.id).toBe('wanted')
    })

    it('returns undefined for an unknown id rather than throwing', () => {
      // The CLI bridge distinguishes "unknown gate" from "dormant gate" and
      // must fail loudly on the first — a typo that silently skips a gate is
      // the worst possible outcome of this design.
      expect(gateById('nope', [record()])).toBeUndefined()
    })
  })

  describe('the shipped registry', () => {
    it('satisfies every invariant', () => {
      expect(validateGatePolicy(GATE_POLICY)).toEqual([])
    })

    it('is not empty', () => {
      expect(GATE_POLICY.length).toBeGreaterThan(0)
    })
  })
})
