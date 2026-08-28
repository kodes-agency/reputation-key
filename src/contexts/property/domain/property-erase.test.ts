import { describe, expect, it } from 'vitest'
import {
  PROPERTY_ERASE_LAST_CANCELLABLE_STATE,
  assertValidPropertyEraseTransition,
  isPropertyEraseIrreversible,
  isValidPropertyEraseTransition,
  matchesPropertyEraseConfirmation,
  propertyEraseConfirmationPhrase,
  propertyLifecycleStateForErase,
  type PropertyEraseState,
} from './property-erase'
import { PROPERTY_ERASE_STATES } from '#/shared/db/schema/property-erase.schema'

const PROPERTY = '60000000-0000-4000-8000-000000000001'

const ALL_STATES: readonly PropertyEraseState[] = [
  'requested',
  'previewed',
  'confirmed',
  'purge_pending',
  'purging',
  'purged',
  'cancelled',
]

describe('property erase state machine (LIF-01-T19)', () => {
  it('matches the states the database enumerates', () => {
    // The schema keeps its own copy so `shared/**` need not import a context
    // domain module. This assertion is what stops the two from drifting.
    expect([...PROPERTY_ERASE_STATES]).toEqual([...ALL_STATES])
  })

  it('treats purging and purged as irreversible', () => {
    expect(PROPERTY_ERASE_LAST_CANCELLABLE_STATE).toBe('purge_pending')
    for (const state of ALL_STATES) {
      expect(isPropertyEraseIrreversible(state)).toBe(
        state === 'purging' || state === 'purged',
      )
    }
  })

  it('allows no transition out of a terminal state', () => {
    for (const terminal of ['purged', 'cancelled'] as const) {
      for (const to of ALL_STATES) {
        expect(isValidPropertyEraseTransition(terminal, to)).toBe(false)
      }
    }
  })

  it('reports cancellation past the boundary with its own error code', () => {
    // An operator calling off a running purge must be told the data is already
    // going, not that they picked a bad state name.
    expect(() => assertValidPropertyEraseTransition('purging', 'cancelled')).toThrow(
      /irreversible/u,
    )
    try {
      assertValidPropertyEraseTransition('purged', 'cancelled')
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toMatchObject({
        _tag: 'PropertyEraseError',
        code: 'irreversible_state',
      })
    }
  })

  it('binds the typed confirmation to one Property', () => {
    expect(propertyEraseConfirmationPhrase(PROPERTY)).toBe(`ERASE PROPERTY ${PROPERTY}`)
    expect(matchesPropertyEraseConfirmation(PROPERTY, `ERASE PROPERTY ${PROPERTY}`)).toBe(
      true,
    )
    // Case folding would turn a deliberate friction step into a checkbox.
    expect(matchesPropertyEraseConfirmation(PROPERTY, `erase property ${PROPERTY}`)).toBe(
      false,
    )
    expect(
      matchesPropertyEraseConfirmation(
        PROPERTY,
        'ERASE PROPERTY 60000000-0000-4000-8000-000000000002',
      ),
    ).toBe(false)
  })

  it('drives the declared properties.lifecycle_state only from purge_pending on', () => {
    expect(propertyLifecycleStateForErase('requested')).toBe('archived')
    expect(propertyLifecycleStateForErase('previewed')).toBe('archived')
    expect(propertyLifecycleStateForErase('confirmed')).toBe('archived')
    expect(propertyLifecycleStateForErase('purge_pending')).toBe('purge_pending')
    expect(propertyLifecycleStateForErase('purging')).toBe('purging')
    expect(propertyLifecycleStateForErase('purged')).toBe('purged')
  })
})
