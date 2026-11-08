import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommandEntrypoint } from './command-entrypoint'

afterEach(() => vi.restoreAllMocks())

describe('operator command entrypoint', () => {
  it('waits for the command without reporting failure or overriding its exit', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('unexpected exit')
    })
    let complete: (() => void) | undefined
    const main = vi.fn(() => new Promise<void>((resolve) => (complete = resolve)))
    let finished = false
    const running = runCommandEntrypoint('ops:example', main).then(() => {
      finished = true
    })

    expect(main).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(finished).toBe(false)
    complete?.()
    await running

    expect(finished).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it.each([
    [new Error('command failed'), 'command failed'],
    ['rejected command', 'rejected command'],
    [null, 'null'],
  ])(
    'reports a rejected command and exits unsuccessfully: %j',
    async (error, message) => {
      const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const stopped = new Error('process stopped')
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw stopped
      })

      await expect(
        runCommandEntrypoint('ops:example', async () => {
          throw error
        }),
      ).rejects.toBe(stopped)

      expect(write).toHaveBeenCalledExactlyOnceWith(`ops:example failed: ${message}\n`)
      expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    },
  )
})
