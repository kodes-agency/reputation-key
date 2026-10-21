import { describe, expect, it } from 'vitest'
import { googleConnectionId } from '#/shared/domain/ids'
import { readBindingFromPropertyScope } from './property-google-read-binding'

const CONNECTION = googleConnectionId('00000000-0000-4000-8000-0000000000b1')
const active = {
  lifecycleState: 'active',
  googleBindingState: 'active',
  googleConnectionId: CONNECTION,
  sourceEpoch: 4,
}

describe('readBindingFromPropertyScope', () => {
  it('names the connection of an active Property with an active Google binding', () => {
    expect(readBindingFromPropertyScope(active)).toEqual({
      connectionId: CONNECTION,
      sourceEpoch: 4,
    })
  })

  it.each([
    ['an archived Property', { ...active, lifecycleState: 'archived' }],
    ['a suspended Property', { ...active, lifecycleState: 'suspended' }],
    ['a disconnected binding', { ...active, googleBindingState: 'disconnected' }],
    [
      'a binding waiting for account confirmation',
      { ...active, googleBindingState: 'account_confirmation_required' },
    ],
    ['an unbound Property', { ...active, googleBindingState: 'unbound' }],
  ])('names no connection for %s, but keeps the epoch', (_name, scope) => {
    expect(readBindingFromPropertyScope(scope)).toEqual({
      connectionId: null,
      sourceEpoch: 4,
    })
  })

  it('names no connection for an active binding that holds none', () => {
    expect(readBindingFromPropertyScope({ ...active, googleConnectionId: null })).toEqual(
      { connectionId: null, sourceEpoch: 4 },
    )
  })

  it('answers null for a Property that does not exist', () => {
    expect(readBindingFromPropertyScope(null)).toBeNull()
  })
})
