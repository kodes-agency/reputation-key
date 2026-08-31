import { describe, expect, it } from 'vitest'
import { reconcileResponsibleManagerSelection } from './responsible-manager-selection'

describe('responsible manager draft reconciliation', () => {
  it('adopts a refreshed server selection when the local selection is clean', () => {
    expect(
      reconcileResponsibleManagerSelection(
        ['admin-1'],
        ['admin-1'],
        ['admin-1', 'manager-1'],
      ),
    ).toEqual(['admin-1', 'manager-1'])
  })

  it('preserves unsaved local edits across a server/query refresh', () => {
    expect(
      reconcileResponsibleManagerSelection(
        ['admin-1', 'manager-local'],
        ['admin-1'],
        ['admin-1', 'manager-remote'],
      ),
    ).toEqual(['admin-1', 'manager-local'])
  })
})
