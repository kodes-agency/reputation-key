import { describe, expect, it } from 'vitest'
import type { GateRecord } from '../../src/shared/release/gate-policy'
import { describeGatePolicy, resolveGateAction } from './gate'

const gate = (overrides: Partial<GateRecord> = {}): GateRecord => ({
  id: 'ci.check/typecheck',
  question: 'Does it compile?',
  location: '.github/workflows/ci.yml:92',
  surface: 'ci:check',
  classification: 'correctness',
  armedFrom: 'closed-beta',
  rationale: 'A type error is wrong code regardless of who runs it.',
  command: 'pnpm typecheck',
  ...overrides,
})

describe('gate CLI bridge', () => {
  describe('resolveGateAction', () => {
    it('runs an armed gate with its declared command', () => {
      expect(resolveGateAction('ci.check/typecheck', 'closed-beta', [gate()])).toEqual({
        action: 'run',
        argv: ['pnpm', 'typecheck'],
      })
    })

    it('skips a dormant gate and says which posture would arm it', () => {
      const dormant = gate({
        id: 'gate-f.opening.cohort_readiness',
        classification: 'audience-dependent',
        armedFrom: 'open-beta',
        command: 'pnpm nope',
      })

      expect(
        resolveGateAction('gate-f.opening.cohort_readiness', 'closed-beta', [dormant]),
      ).toEqual({
        action: 'skip',
        reason: 'dormant at closed-beta; arms at open-beta',
      })
    })

    it('fails on an unknown id rather than skipping it', () => {
      // The critical distinction. A typo that silently "skips" a gate is the
      // worst outcome available to this design: CI stays green and the gate
      // never ran. Unknown must be loud.
      expect(resolveGateAction('ci.check/typcheck', 'closed-beta', [gate()])).toEqual({
        action: 'fail',
        reason: 'unknown gate id: ci.check/typcheck',
      })
    })

    it('fails on an armed gate that declares no command', () => {
      const evidence = gate({ id: 'gate-f.approvals', command: undefined })

      expect(resolveGateAction('gate-f.approvals', 'closed-beta', [evidence])).toEqual({
        action: 'fail',
        reason: 'gate gate-f.approvals is armed but declares no command to run',
      })
    })

    it('arms the same gate once the posture widens past its threshold', () => {
      const dormant = gate({
        id: 'late',
        classification: 'audience-dependent',
        armedFrom: 'open-beta',
        command: 'pnpm late',
      })

      expect(resolveGateAction('late', 'open-beta', [dormant])).toEqual({
        action: 'run',
        argv: ['pnpm', 'late'],
      })
    })
  })

  describe('describeGatePolicy', () => {
    it('counts armed and dormant gates at a posture', () => {
      const gates = [
        gate({ id: 'a' }),
        gate({ id: 'b', classification: 'audience-dependent', armedFrom: 'open-beta' }),
        gate({ id: 'c', classification: 'audience-dependent', armedFrom: 'ga' }),
      ]

      const summary = describeGatePolicy('closed-beta', gates)

      expect(summary.posture).toBe('closed-beta')
      expect(summary.armed.map((entry) => entry.id)).toEqual(['a'])
      expect(summary.dormant.map((entry) => entry.id)).toEqual(['b', 'c'])
    })

    it('surfaces audience-dependent gates deliberately kept armed', () => {
      const gates = [
        gate({
          id: 'kept',
          classification: 'audience-dependent',
          armedFrom: 'closed-beta',
        }),
      ]

      expect(describeGatePolicy('closed-beta', gates).keptArmedByChoice).toEqual(['kept'])
    })

    it('reports registry violations rather than hiding them behind a count', () => {
      const broken = [gate({ id: 'bad', classification: 'correctness', armedFrom: 'ga' })]

      expect(describeGatePolicy('closed-beta', broken).violations).toEqual([
        { gateId: 'bad', reason: 'correctness gate must be armed at every posture' },
      ])
    })
  })
})
