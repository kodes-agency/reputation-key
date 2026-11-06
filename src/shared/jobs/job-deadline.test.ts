import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runJobWithDeadline } from './job-deadline.server'
import { JobTimeoutError } from './errors'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('job deadline lifecycle', () => {
  it('preserves a normal failure and clears the deadline and termination timers', async () => {
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never)
    const failure = new Error('handler failed')

    await expect(
      runJobWithDeadline('test-job', 10, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    expect(exit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports timeout after cooperative rejection and cancels termination', async () => {
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never)
    const outcome = runJobWithDeadline(
      'test-job',
      10,
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          })
        }),
    ).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(10)
    expect(await outcome).toBeInstanceOf(JobTimeoutError)
    await vi.runAllTimersAsync()
    expect(exit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('exits a real process nonzero while its uncooperative handler stays pending', async () => {
    const moduleUrl = new URL('./job-deadline.server.ts', import.meta.url).href
    const source = `
      import { runJobWithDeadline } from ${JSON.stringify(moduleUrl)};
      await runJobWithDeadline('test-job', 1, () => {
        console.log('started');
        return new Promise(() => {});
      }).then(() => console.log('released'), () => console.log('released'));
    `
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', source],
      { timeout: 10_000 },
    ).then(
      () => {
        throw new Error('worker should have terminated')
      },
      (error: unknown) => error,
    )

    expect(result).toMatchObject({ code: 1, stderr: '' })
    const stdout = (result as { stdout: string }).stdout
    expect(stdout).toContain('started\n')
    expect(stdout).not.toContain('released')
    expect(stdout).toContain('job did not stop after abort grace; terminating worker')
  }, 15_000)
})
