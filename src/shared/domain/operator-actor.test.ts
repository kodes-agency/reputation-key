import { describe, expect, it } from 'vitest'
import {
  OPERATOR_ACTOR_PREFIX,
  isOperatorActorId,
  operatorHandleOf,
} from './operator-actor'

describe('operator actor identity', () => {
  it('marks an operator with the ops: prefix', () => {
    expect(OPERATOR_ACTOR_PREFIX).toBe('ops:')
    expect(isOperatorActorId('ops:denev')).toBe(true)
  })

  it('never reads a user identifier as an operator', () => {
    expect(isOperatorActorId('manager-1')).toBe(false)
    expect(isOperatorActorId('0b6f6c3e-5a0a-4f0e-9a39-2f1d9a1f6a11')).toBe(false)
    expect(isOperatorActorId('')).toBe(false)
    expect(isOperatorActorId('xops:denev')).toBe(false)
  })

  it('gives the handle without the prefix, and none for a bare prefix or a user', () => {
    expect(operatorHandleOf('ops:denev')).toBe('denev')
    expect(operatorHandleOf('ops:')).toBeNull()
    expect(operatorHandleOf('manager-1')).toBeNull()
  })
})
