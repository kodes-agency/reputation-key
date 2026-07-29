// BQC-6.5 — E2E global setup: boot the GBP stub + the real BullMQ worker.
//
// Beyond the Playwright-managed web servers, the critical workflow suite
// needs two out-of-process dependencies:
//
//   1. GBP stub server (e2e/fixtures/gbp-stub.ts) — in-process on port 4100.
//      The web servers and the worker reach it over HTTP through the BQC-6.5
//      sandbox env overrides (GBP_API_BASE_URL & friends); specs script and
//      interrogate it through its HTTP control surface. The Playwright runner
//      process stays alive for the whole run, so the in-process stub does too.
//   2. The BullMQ worker (pnpm dev:worker) as a child process — there is no
//      inline-process mode in the real app, so the suite runs the real
//      worker: review sync, reply publish, import, and activity/notification
//      insert jobs all execute here. Env = the BQC-6.1 test-environment floor
//      + explicit shell/CI values + the GBP sandbox overrides.
//
// Readiness: the worker logs 'BullMQ worker started on default queue' once
// bootstrap + policy refresh + handler registration complete; setup waits for
// that line (bounded) so no test can enqueue into a worker that is not up.
// Teardown (e2e/global-teardown.ts) kills the worker and stops the stub. The
// worker PID is persisted to e2e/.orchestration-state.json so a crashed
// runner never leaves an orphaned worker behind.

import { spawn } from 'node:child_process'
import { writeFileSync, createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { testEnvironment } from '../src/shared/testing/test-environment'
import { startGbpStub, GBP_SANDBOX_ENV } from './fixtures/gbp-stub'
import {
  WORKER_READY_LINE,
  WORKER_READY_TIMEOUT_MS,
  STATE_PATH,
  setHandles,
  killWorker,
} from './orchestration'

/** Worker stdout/stderr are captured here (failure diagnostics floor — the
 * file is inside outputDir so CI uploads it with the other artifacts). */
export const WORKER_LOG_PATH = 'test-results/e2e-worker.log'

export default async function globalSetup(): Promise<void> {
  // 1. GBP stub.
  const stub = await startGbpStub()

  // 2. Worker child process. dotenv/config inside src/worker/index.ts does
  //    NOT override existing env, so everything set here wins over .env.
  const worker = spawn('pnpm', ['dev:worker'], {
    cwd: process.cwd(),
    env: {
      ...testEnvironment(),
      ...process.env,
      // After the spreads so nothing can unset them: the sandbox seam pins
      // every Google endpoint at the stub for the worker process.
      ...GBP_SANDBOX_ENV,
      E2E: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  mkdirSync(dirname(WORKER_LOG_PATH), { recursive: true })
  const workerLog = createWriteStream(WORKER_LOG_PATH, { flags: 'w' })
  worker.stdout?.pipe(workerLog)
  worker.stderr?.pipe(workerLog)

  let outputTail = ''
  const capture = (chunk: Buffer) => {
    outputTail = `${outputTail}${chunk.toString()}`.slice(-8_000)
  }
  worker.stdout?.on('data', capture)
  worker.stderr?.on('data', capture)

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(
        new Error(
          `E2E worker did not become ready within ${WORKER_READY_TIMEOUT_MS}ms ` +
            `(waiting for "${WORKER_READY_LINE}").\n── worker output tail ──\n${outputTail}`,
        ),
      )
    }, WORKER_READY_TIMEOUT_MS)

    worker.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(WORKER_READY_LINE)) {
        clearTimeout(timer)
        resolvePromise()
      }
    })
    worker.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(
        new Error(
          `E2E worker exited before readiness (code ${code}).\n── worker output tail ──\n${outputTail}`,
        ),
      )
    })
  }).catch((err: unknown) => {
    if (worker.pid) void killWorker(worker.pid)
    void stub.stop()
    throw err
  })

  worker.removeAllListeners('exit')

  writeFileSync(
    STATE_PATH,
    `${JSON.stringify({ workerPid: worker.pid, stubPort: stub.port })}\n`,
  )

  setHandles({ stub, worker })
}
