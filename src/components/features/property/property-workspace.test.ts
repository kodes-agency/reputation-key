import { describe, expect, it } from 'vitest'
import { isWorkspaceProperty, partitionWorkspaceProperties } from './property-workspace'

const property = (id: string, lifecycleState: string) => ({ id, lifecycleState })

describe('property workspace visibility', () => {
  it('keeps active and suspended properties in the workspace', () => {
    expect(isWorkspaceProperty('active')).toBe(true)
    // Suspended is an administrative hold, not a removal — it stays visible so
    // the operator can see why the Property stopped working.
    expect(isWorkspaceProperty('suspended')).toBe(true)
  })

  it('treats every state from archived onward as removed', () => {
    for (const state of ['archived', 'disconnecting', 'purge_pending', 'purging']) {
      expect(isWorkspaceProperty(state)).toBe(false)
    }
  })

  it('splits properties into workspace and removed without losing any', () => {
    const properties = [
      property('a', 'active'),
      property('b', 'archived'),
      property('c', 'suspended'),
      property('d', 'purge_pending'),
    ]

    const { workspace, removed } = partitionWorkspaceProperties(properties)

    expect(workspace.map((p) => p.id)).toEqual(['a', 'c'])
    expect(removed.map((p) => p.id)).toEqual(['b', 'd'])
  })

  it('lists a purged property in neither bucket', () => {
    // Purge retains only evidence records, so there is no Property left to show.
    const { workspace, removed } = partitionWorkspaceProperties([
      property('gone', 'purged'),
      property('here', 'active'),
    ])

    expect(workspace.map((p) => p.id)).toEqual(['here'])
    expect(removed).toEqual([])
  })
})
