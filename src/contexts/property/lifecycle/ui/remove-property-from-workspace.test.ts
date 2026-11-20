import { describe, expect, it, vi } from 'vitest'
import { removePropertyFromWorkspace } from './remove-property-from-workspace'

const input = { data: { propertyId: 'p-1', reason: 'Removed from workspace' } }

const commands = (googleBindingState: string, disconnect = vi.fn(async () => ({}))) => ({
  archive: vi.fn(async () => ({ property: { googleBindingState } })),
  disconnect,
})

describe('removePropertyFromWorkspace', () => {
  it('archives and then disconnects an actively bound Property', async () => {
    const deps = commands('active')

    await expect(removePropertyFromWorkspace(input, deps)).resolves.toEqual({
      googleDisconnected: true,
    })
    expect(deps.archive).toHaveBeenCalledWith(input)
    expect(deps.disconnect).toHaveBeenCalledWith({ data: { propertyId: 'p-1' } })
  })

  it.each(['unbound', 'disconnected', 'account_confirmation_required'])(
    'skips the disconnect for a %s binding that has nothing to disconnect',
    async (state) => {
      const deps = commands(state)

      await expect(removePropertyFromWorkspace(input, deps)).resolves.toEqual({
        googleDisconnected: true,
      })
      expect(deps.disconnect).not.toHaveBeenCalled()
    },
  )

  it('reports the unfinished disconnect instead of failing the whole removal', async () => {
    // The Property is already archived at this point, so it has left the
    // workspace; claiming the removal failed would be the inaccurate answer.
    const deps = commands(
      'active',
      vi.fn(async () => {
        throw new Error('binding locked')
      }),
    )

    await expect(removePropertyFromWorkspace(input, deps)).resolves.toEqual({
      googleDisconnected: false,
    })
  })

  it('propagates an archive failure, having changed nothing', async () => {
    const deps = {
      archive: vi.fn(async () => {
        throw new Error('archive refused')
      }),
      disconnect: vi.fn(async () => ({})),
    }

    await expect(removePropertyFromWorkspace(input, deps)).rejects.toThrow(
      'archive refused',
    )
    expect(deps.disconnect).not.toHaveBeenCalled()
  })
})
