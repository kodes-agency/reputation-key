import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { spawnBetaCommand } from './command-runner'

const STORYBOOK_URL = 'http://127.0.0.1:6006'

async function waitForStorybook(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(STORYBOOK_URL)
      if (response.ok) return
    } catch {
      // Storybook has not opened its socket yet.
    }
    await delay(250)
  }
  throw new Error(`Storybook did not become ready at ${STORYBOOK_URL}`)
}

export async function runStorybookGate(): Promise<number> {
  const storybook = spawn('pnpm', ['storybook', '--ci'], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
  })
  try {
    const { promise: exitedBeforeReady, reject } = Promise.withResolvers<never>()
    storybook.once('exit', (code, signal) =>
      reject(new Error(`Storybook exited before readiness (${signal ?? String(code)})`)),
    )
    storybook.once('error', reject)
    await Promise.race([waitForStorybook(), exitedBeforeReady])
    const result = await spawnBetaCommand({
      executable: 'pnpm',
      args: ['test-storybook'],
    })
    return result.exitCode
  } finally {
    if (storybook.exitCode == null) storybook.kill('SIGTERM')
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runStorybookGate()
}
