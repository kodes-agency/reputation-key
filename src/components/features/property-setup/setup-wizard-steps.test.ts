import { describe, expect, it } from 'vitest'
import {
  discoveryWizardStep,
  importWizardStep,
  setupWizardStepPosition,
} from './setup-wizard-steps'

const active = [{ status: 'active' }]

describe('import wizard step', () => {
  it('asks for a Google account until an active one is chosen', () => {
    expect(
      discoveryWizardStep({ connections: [], connectionId: null, step: 'discover' }),
    ).toBe('connect')
    expect(
      discoveryWizardStep({
        connections: [{ status: 'reauthorization_required' }],
        connectionId: 'connection-1',
        step: 'discover',
      }),
    ).toBe('connect')
    expect(
      discoveryWizardStep({ connections: active, connectionId: null, step: 'discover' }),
    ).toBe('connect')
  })

  it('follows discovery into the confirm-details table', () => {
    expect(
      discoveryWizardStep({
        connections: active,
        connectionId: 'connection-1',
        step: 'discover',
      }),
    ).toBe('locations')
    expect(
      discoveryWizardStep({
        connections: active,
        connectionId: 'connection-1',
        step: 'review',
      }),
    ).toBe('confirm')
  })

  it('moves from import to setup once the import settles with properties', () => {
    expect(importWizardStep({ settled: false, importedPropertyCount: 3 })).toBe('import')
    expect(importWizardStep({ settled: true, importedPropertyCount: 0 })).toBe('import')
    expect(importWizardStep({ settled: true, importedPropertyCount: 1 })).toBe('setup')
  })

  it('numbers the steps for the compact caption', () => {
    expect(setupWizardStepPosition('confirm')).toEqual({
      number: 3,
      total: 5,
      title: 'Confirm details',
    })
  })
})
