import { spawn } from 'node:child_process'
import type {
  BetaCommandResult,
  BetaCommandRunner,
} from '../../src/shared/testing/beta-local-evidence'

export const spawnBetaCommand: BetaCommandRunner = (command, options) => {
  const {
    promise,
    resolve: resolveResult,
    reject,
  } = Promise.withResolvers<BetaCommandResult>()
  const child = spawn(command.executable, [...command.args], {
    cwd: process.cwd(),
    env: options?.env ?? process.env,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stderr += text
    process.stderr.write(text)
  })
  child.once('error', reject)
  child.once('close', (code, signal) => {
    resolveResult({
      exitCode: code ?? (signal ? 1 : 0),
      stdout,
      stderr: signal ? `${stderr}\nterminated by ${signal}` : stderr,
    })
  })
  return promise
}
