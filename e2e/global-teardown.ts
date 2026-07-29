// BQC-6.5 — E2E global teardown: stop the worker + GBP stub from global setup.

import {
  getHandles,
  setHandles,
  readState,
  clearState,
  killWorker,
} from './orchestration'

export default async function globalTeardown(): Promise<void> {
  const handles = getHandles()
  if (handles) {
    if (handles.worker.pid && handles.worker.exitCode === null) {
      await killWorker(handles.worker.pid)
    }
    await handles.stub.stop()
    setHandles(undefined)
  } else {
    // Defensive: different process — fall back to the persisted PID.
    const state = readState()
    if (state) await killWorker(state.workerPid)
  }
  clearState()
}
