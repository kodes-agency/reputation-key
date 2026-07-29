// BQC-6.5 — E2E orchestration shared state/logic for global setup + teardown.
// See e2e/global-setup.ts for the full rationale.

import { type ChildProcess } from 'node:child_process'
import { rmSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GbpStub } from './fixtures/gbp-stub'

export const WORKER_READY_LINE = 'BullMQ worker started on default queue'
export const WORKER_READY_TIMEOUT_MS = 120_000
export const STATE_PATH = resolve(process.cwd(), 'e2e/.orchestration-state.json')

export type OrchestrationState = {
  workerPid: number
  stubPort: number
}

export type SetupHandles = {
  stub: GbpStub
  worker: ChildProcess
}

const globalKey = '__e2eOrchestration__'

export function setHandles(handles: SetupHandles | undefined): void {
  ;(globalThis as Record<string, unknown>)[globalKey] = handles
}

export function getHandles(): SetupHandles | undefined {
  return (globalThis as Record<string, unknown>)[globalKey] as SetupHandles | undefined
}

export function readState(): OrchestrationState | null {
  if (!existsSync(STATE_PATH)) return null
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as OrchestrationState
  } catch {
    return null
  }
}

export function clearState(): void {
  rmSync(STATE_PATH, { force: true })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** SIGTERM with a bounded grace period, then SIGKILL. */
export async function killWorker(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return // already gone
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return // exited
    }
    await sleep(100)
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}
